-- ============================================================================
-- 20260727090900_deck
-- The worldwide swipe deck: candidate ranking + swipe recording + undo.
--
-- ANONYMITY (§9): get_deck reads the caller's OWN swipes only, to exclude posts
-- they've already seen. It never selects, returns, or aggregates another user's
-- swipe rows or direction. Swipe writes go through record_swipe; the ledger is
-- only ever touched server-side (award_points / _award_to).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- get_deck: ranked candidate pool for the worldwide feed.
--   * public + approved posts, excluding own posts, already-swiped posts,
--     block relationships (either direction), and an explicit _exclude list
--     (posts already loaded into the current client deck, for prefetch dedup).
--   * score = tag affinity (dominant) + freshness decay + poster points boost.
--   * ~90% of the batch comes from tag-matched posts by score; the remainder is
--     filled from off-profile popular-recent posts. This one mechanism delivers
--     BOTH the "~10% off-profile" exploration for engaged users AND the
--     new-user / no-match fallback (matched is empty → whole batch is popular
--     recent, never an empty deck).
-- SECURITY DEFINER: needs poster points_balance + the block graph; returns only
-- public post/profile fields, never swipe data.
-- ---------------------------------------------------------------------------
create or replace function public.get_deck(_limit integer default 20, _exclude uuid[] default '{}')
returns table (
  id                  uuid,
  user_id             uuid,
  media_url           text,
  thumbnail_url       text,
  media_type          text,
  caption             text,
  alt_text            text,
  like_count          integer,
  skip_count          integer,
  comment_count       integer,
  created_at          timestamptz,
  poster_handle       text,
  poster_display_name text,
  poster_avatar_url   text,
  tags                text[]
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with base as (
    select p.id, p.user_id, p.media_url, p.thumbnail_url, p.media_type, p.caption,
           p.alt_text, p.like_count, p.skip_count, p.comment_count, p.created_at
    from public.posts p
    where p.visibility = 'public'
      and p.moderation_status = 'approved'
      and p.user_id <> auth.uid()
      and p.id <> all(_exclude)
      and not exists (
        select 1 from public.swipes s where s.user_id = auth.uid() and s.post_id = p.id
      )
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
           or (b.blocker_id = p.user_id and b.blocked_id = auth.uid())
      )
  ),
  ranked as (
    select b.*,
      coalesce((
        select sum(ut.weight)
        from public.post_tags pt
        join public.user_tags ut on ut.tag_id = pt.tag_id and ut.user_id = auth.uid()
        where pt.post_id = b.id
      ), 0)::double precision as affinity,
      exp(-extract(epoch from (now() - b.created_at)) / (72.0 * 3600.0)) as freshness,
      ln(2 + coalesce(pr.points_balance, 0)) as points_boost
    from base b
    join public.profiles pr on pr.id = b.user_id
  ),
  ranked2 as (
    select r.*,
      (r.affinity * 3.0 + r.freshness * 2.0 + r.points_boost * 0.5) as score
    from ranked r
  ),
  matched as (
    select * from ranked2 where affinity > 0
    order by score desc
    limit ceil(_limit * 0.9)
  ),
  explore as (
    select * from ranked2
    where affinity = 0 and id not in (select id from matched)
    order by (freshness * 2.0 + points_boost * 0.5) desc, random()
    limit greatest(_limit - (select count(*) from matched), 0)
  ),
  combined as (
    select * from matched
    union all
    select * from explore
  )
  select
    c.id, c.user_id, c.media_url, c.thumbnail_url, c.media_type, c.caption,
    c.alt_text, c.like_count, c.skip_count, c.comment_count, c.created_at,
    pr.handle, pr.display_name, pr.avatar_url,
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tags
  from combined c
  join public.profiles pr on pr.id = c.user_id
  left join public.post_tags pt on pt.post_id = c.id
  left join public.tags t on t.id = pt.tag_id
  group by
    c.id, c.user_id, c.media_url, c.thumbnail_url, c.media_type, c.caption,
    c.alt_text, c.like_count, c.skip_count, c.comment_count, c.created_at, c.score,
    pr.handle, pr.display_name, pr.avatar_url
  order by c.score desc
  limit _limit;
$fn$;

revoke all on function public.get_deck(integer, uuid[]) from public;
grant execute on function public.get_deck(integer, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- record_swipe: insert the caller's swipe and award points server-side.
--   Idempotent (swipes PK is (user_id, post_id) + ON CONFLICT DO NOTHING) so a
--   retried offline-queue item never double-inserts or double-awards. The like/
--   skip counter trigger fires on the insert. Returns the new points balance.
-- SECURITY INVOKER: the insert runs under RLS (own rows only); award_points is
-- itself SECURITY DEFINER and decides the delta — the client never sees or
-- constructs a ledger row.
-- ---------------------------------------------------------------------------
create or replace function public.record_swipe(_post_id uuid, _direction text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  _inserted integer;
  _balance  bigint;
begin
  if _direction not in ('left', 'right') then
    raise exception 'record_swipe: direction must be left or right';
  end if;

  insert into public.swipes (user_id, post_id, direction)
  values (auth.uid(), _post_id, _direction)
  on conflict (user_id, post_id) do nothing;
  get diagnostics _inserted = row_count;

  if _inserted > 0 then
    _balance := public.award_points('swipe', 'swipe', _post_id);
  else
    select points_balance into _balance from public.profiles where id = auth.uid();
  end if;
  return _balance;
end;
$fn$;

revoke all on function public.record_swipe(uuid, text) from public;
grant execute on function public.record_swipe(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- undo_swipe: single-step undo. Deletes the caller's swipe row (the counter
-- trigger reverses like/skip) and reverses the points award by inserting a
-- COMPENSATING negative ledger row — never by mutating or deleting a ledger row.
-- Idempotent: if there's no swipe to undo it is a no-op. Returns new balance.
-- SECURITY DEFINER so it can insert the compensating entry via _award_to.
-- ---------------------------------------------------------------------------
create or replace function public.undo_swipe(_post_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _deleted  integer;
  _original integer;
  _balance  bigint;
begin
  delete from public.swipes where user_id = auth.uid() and post_id = _post_id;
  get diagnostics _deleted = row_count;

  if _deleted > 0 then
    -- Find what the original swipe awarded and post a compensating negative row.
    select delta into _original
    from public.points_ledger
    where user_id = auth.uid()
      and reason = 'swipe'
      and ref_type = 'swipe'
      and ref_id = _post_id
    order by created_at desc
    limit 1;

    if _original is not null and _original <> 0 then
      perform public._award_to(auth.uid(), -_original, 'swipe_undo', 'swipe', _post_id);
    end if;
  end if;

  select points_balance into _balance from public.profiles where id = auth.uid();
  return _balance;
end;
$fn$;

revoke all on function public.undo_swipe(uuid) from public;
grant execute on function public.undo_swipe(uuid) to authenticated;

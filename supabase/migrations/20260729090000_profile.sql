-- ============================================================================
-- 20260729090000_profile
-- Backend for the Profile tab: reach + share tracking, mutes (with deck
-- filtering), true profile counts, ANONYMITY-SAFE creator analytics,
-- notification prefs, account export + deletion.
--
-- ANONYMITY (§9/§11): every analytics function returns AGGREGATE numbers only.
-- None expose per-viewer rows, swipe direction attribution, or a timeline fine
-- enough to correlate a skip with a person. Rates on tiny samples are
-- SUPPRESSED (returned null) rather than shown — see MIN_BUCKET.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Reach + shares. reach_count is maintained as "distinct swipers" (a swipe
--    means the post was served/seen); share_count via an explicit action.
-- ---------------------------------------------------------------------------
alter table public.posts add column if not exists share_count integer not null default 0;

-- Extend the swipe counter trigger to also maintain reach_count.
create or replace function public.tg_swipes_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (tg_op = 'INSERT') then
    if new.direction = 'right' then
      update public.posts set like_count = like_count + 1, reach_count = reach_count + 1 where id = new.post_id;
    else
      update public.posts set skip_count = skip_count + 1, reach_count = reach_count + 1 where id = new.post_id;
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if old.direction = 'right' then
      update public.posts set like_count = greatest(like_count - 1, 0), reach_count = greatest(reach_count - 1, 0) where id = old.post_id;
    else
      update public.posts set skip_count = greatest(skip_count - 1, 0), reach_count = greatest(reach_count - 1, 0) where id = old.post_id;
    end if;
    return old;
  end if;
  return null;
end;
$fn$;

-- record_share: count a share (opening the share sheet). Aggregate count only.
create or replace function public.record_share(_post_id uuid)
returns integer
language sql
security definer
set search_path = ''
as $fn$
  update public.posts set share_count = share_count + 1 where id = _post_id returning share_count;
$fn$;
revoke all on function public.record_share(uuid) from public;
grant execute on function public.record_share(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Mutes — hide someone's content from the muter's feed (no block).
-- ---------------------------------------------------------------------------
create table if not exists public.mutes (
  muter_id   uuid not null references public.profiles (id) on delete cascade,
  muted_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint mutes_no_self check (muter_id <> muted_id)
);
alter table public.mutes enable row level security;
create policy mutes_select_own on public.mutes for select to authenticated using (muter_id = auth.uid());
create policy mutes_insert_own on public.mutes for insert to authenticated with check (muter_id = auth.uid());
create policy mutes_delete_own on public.mutes for delete to authenticated using (muter_id = auth.uid());

create or replace function public.is_muting(_other uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.mutes where muter_id = auth.uid() and muted_id = _other);
$fn$;
revoke all on function public.is_muting(uuid) from public;
grant execute on function public.is_muting(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Deck functions filter out muted authors (in addition to blocks).
--    Re-created with a single extra clause; everything else is unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.get_deck(_limit integer default 20, _exclude uuid[] default '{}')
returns table (
  id uuid, user_id uuid, media_url text, thumbnail_url text, media_type text, caption text,
  alt_text text, like_count integer, skip_count integer, comment_count integer, created_at timestamptz,
  poster_handle text, poster_display_name text, poster_avatar_url text, tags text[]
) language sql stable security definer set search_path = '' as $fn$
  with base as (
    select p.id, p.user_id, p.media_url, p.thumbnail_url, p.media_type, p.caption,
           p.alt_text, p.like_count, p.skip_count, p.comment_count, p.created_at
    from public.posts p
    where p.visibility = 'public' and p.moderation_status = 'approved'
      and p.user_id <> auth.uid() and p.id <> all(_exclude)
      and not exists (select 1 from public.swipes s where s.user_id = auth.uid() and s.post_id = p.id)
      and not exists (select 1 from public.blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id) or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
      and not exists (select 1 from public.mutes m where m.muter_id = auth.uid() and m.muted_id = p.user_id)
  ),
  ranked as (
    select b.*,
      coalesce((select sum(ut.weight) from public.post_tags pt
        join public.user_tags ut on ut.tag_id = pt.tag_id and ut.user_id = auth.uid()
        where pt.post_id = b.id), 0)::double precision as affinity,
      exp(-extract(epoch from (now() - b.created_at)) / (72.0 * 3600.0)) as freshness,
      ln(2 + coalesce(pr.points_balance, 0)) as points_boost
    from base b join public.profiles pr on pr.id = b.user_id
  ),
  ranked2 as (select r.*, (r.affinity * 3.0 + r.freshness * 2.0 + r.points_boost * 0.5) as score from ranked r),
  matched as (select * from ranked2 where affinity > 0 order by score desc limit ceil(_limit * 0.9)),
  explore as (select * from ranked2 where affinity = 0 and id not in (select id from matched)
    order by (freshness * 2.0 + points_boost * 0.5) desc, random() limit greatest(_limit - (select count(*) from matched), 0)),
  combined as (select * from matched union all select * from explore)
  select c.id, c.user_id, c.media_url, c.thumbnail_url, c.media_type, c.caption, c.alt_text,
    c.like_count, c.skip_count, c.comment_count, c.created_at, pr.handle, pr.display_name, pr.avatar_url,
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tags
  from combined c join public.profiles pr on pr.id = c.user_id
  left join public.post_tags pt on pt.post_id = c.id left join public.tags t on t.id = pt.tag_id
  group by c.id, c.user_id, c.media_url, c.thumbnail_url, c.media_type, c.caption, c.alt_text,
    c.like_count, c.skip_count, c.comment_count, c.created_at, c.score, pr.handle, pr.display_name, pr.avatar_url
  order by c.score desc limit _limit;
$fn$;

create or replace function public.get_following_deck(_limit integer default 20, _exclude uuid[] default '{}')
returns table (
  id uuid, user_id uuid, media_url text, thumbnail_url text, media_type text, caption text,
  alt_text text, like_count integer, skip_count integer, comment_count integer, created_at timestamptz,
  poster_handle text, poster_display_name text, poster_avatar_url text, tags text[]
) language sql stable security definer set search_path = '' as $fn$
  with base as (
    select p.id, p.user_id, p.media_url, p.thumbnail_url, p.media_type, p.caption,
           p.alt_text, p.like_count, p.skip_count, p.comment_count, p.created_at
    from public.posts p
    join public.follows f on f.followee_id = p.user_id and f.follower_id = auth.uid() and f.status = 'accepted'
    where p.moderation_status = 'approved' and p.visibility in ('public', 'private')
      and p.user_id <> auth.uid() and p.id <> all(_exclude)
      and not exists (select 1 from public.swipes s where s.user_id = auth.uid() and s.post_id = p.id)
      and not exists (select 1 from public.blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id) or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
      and not exists (select 1 from public.mutes m where m.muter_id = auth.uid() and m.muted_id = p.user_id)
  )
  select b.id, b.user_id, b.media_url, b.thumbnail_url, b.media_type, b.caption, b.alt_text,
    b.like_count, b.skip_count, b.comment_count, b.created_at, pr.handle, pr.display_name, pr.avatar_url,
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tags
  from base b join public.profiles pr on pr.id = b.user_id
  left join public.post_tags pt on pt.post_id = b.id left join public.tags t on t.id = pt.tag_id
  group by b.id, b.user_id, b.media_url, b.thumbnail_url, b.media_type, b.caption, b.alt_text,
    b.like_count, b.skip_count, b.comment_count, b.created_at, pr.handle, pr.display_name, pr.avatar_url
  order by b.created_at desc limit greatest(_limit, 0);
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Profile header data. Counts are PUBLIC (visible even on a locked private
--    profile), so this is SECURITY DEFINER — it must not be filtered by the
--    posts RLS that hides private posts from non-followers.
-- ---------------------------------------------------------------------------
create or replace function public.get_profile_overview(_handle text)
returns table (
  id uuid, handle text, display_name text, bio text, avatar_url text, is_private boolean,
  follower_count integer, following_count integer, post_count integer,
  is_self boolean, follow_status text, is_blocked boolean, is_muting boolean, locked boolean
) language sql stable security definer set search_path = '' as $fn$
  with p as (select * from public.profiles where handle = _handle)
  select p.id, p.handle, p.display_name, p.bio, p.avatar_url, p.is_private,
    (select count(*)::int from public.follows f where f.followee_id = p.id and f.status = 'accepted'),
    (select count(*)::int from public.follows f where f.follower_id = p.id and f.status = 'accepted'),
    (select count(*)::int from public.posts po where po.user_id = p.id and po.moderation_status <> 'removed'),
    (p.id = auth.uid()) as is_self,
    (select f.status from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id) as follow_status,
    public.is_blocked_with(p.id) as is_blocked,
    public.is_muting(p.id) as is_muting,
    -- locked: a private account you're neither the owner of nor an accepted follower of.
    (p.is_private and p.id <> auth.uid()
       and not exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id and f.status = 'accepted')) as locked
  from p;
$fn$;
revoke all on function public.get_profile_overview(text) from public;
grant execute on function public.get_profile_overview(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. CREATOR ANALYTICS — owner-only, aggregate-only, small buckets suppressed.
-- ---------------------------------------------------------------------------

-- Per-post: aggregate counts + like/skip rate. Rates are NULL when the sample
-- is too small to be meaningful (and to avoid any chance of correlation).
create or replace function public.get_post_analytics(_post_id uuid)
returns table (
  reach integer, likes integer, skips integer, comments integer, shares integer,
  like_rate double precision, skip_rate double precision, sample_suppressed boolean
) language plpgsql stable security definer set search_path = '' as $fn$
declare
  min_bucket constant integer := 5;  -- suppress rates below this many swipes
  p public.posts;
  total integer;
begin
  select * into p from public.posts where id = _post_id;
  if not found or p.user_id <> auth.uid() then
    raise exception 'not authorised';  -- own posts only
  end if;
  total := p.like_count + p.skip_count;
  return query select
    p.reach_count, p.like_count, p.skip_count, p.comment_count, p.share_count,
    case when total >= min_bucket then p.like_count::double precision / total else null end,
    case when total >= min_bucket then p.skip_count::double precision / total else null end,
    (total < min_bucket);
end;
$fn$;
revoke all on function public.get_post_analytics(uuid) from public;
grant execute on function public.get_post_analytics(uuid) to authenticated;

-- Account-level: follower total, follower growth by WEEK (aggregate counts of
-- new accepted follows — never who), points, and the distribution multiplier
-- the ranking actually applies (ln(2+balance), matching get_deck).
create or replace function public.get_account_analytics()
returns table (
  follower_count integer, post_count integer, total_reach bigint,
  points_balance bigint, points_lifetime bigint, distribution_multiplier double precision,
  follower_growth jsonb
) language sql stable security definer set search_path = '' as $fn$
  select
    (select count(*)::int from public.follows f where f.followee_id = auth.uid() and f.status = 'accepted'),
    (select count(*)::int from public.posts p where p.user_id = auth.uid() and p.moderation_status <> 'removed'),
    (select coalesce(sum(reach_count), 0)::bigint from public.posts p where p.user_id = auth.uid()),
    (select points_balance from public.profiles where id = auth.uid()),
    (select points_lifetime from public.profiles where id = auth.uid()),
    ln(2 + coalesce((select points_balance from public.profiles where id = auth.uid()), 0))::double precision,
    coalesce((
      select jsonb_agg(jsonb_build_object('week', wk, 'new_followers', n) order by wk)
      from (
        select date_trunc('week', f.created_at)::date as wk, count(*)::int as n
        from public.follows f
        where f.followee_id = auth.uid() and f.status = 'accepted'
        group by 1
      ) g
    ), '[]'::jsonb);
$fn$;
revoke all on function public.get_account_analytics() from public;
grant execute on function public.get_account_analytics() to authenticated;

-- Tag reach — "which of my tags actually pull reach". Aggregate over the
-- caller's own posts, per tag. Tags whose total swipe sample is below the
-- bucket floor are suppressed (not returned) so nothing tiny is shown.
create or replace function public.get_tag_reach()
returns table (tag text, posts integer, reach bigint, likes bigint, like_rate double precision)
language sql stable security definer set search_path = '' as $fn$
  with agg as (
    select t.name as tag, count(distinct p.id)::int as posts,
      sum(p.reach_count)::bigint as reach, sum(p.like_count)::bigint as likes,
      sum(p.like_count + p.skip_count)::bigint as swipes
    from public.posts p
    join public.post_tags pt on pt.post_id = p.id
    join public.tags t on t.id = pt.tag_id
    where p.user_id = auth.uid() and p.moderation_status <> 'removed'
    group by t.name
  )
  select tag, posts, reach, likes,
    case when swipes >= 5 then likes::double precision / swipes else null end
  from agg
  where swipes >= 5          -- suppress tiny buckets entirely
  order by reach desc, likes desc;
$fn$;
revoke all on function public.get_tag_reach() from public;
grant execute on function public.get_tag_reach() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Notification preferences (per category). No delivery yet — stored for
--    when notifications ship.
-- ---------------------------------------------------------------------------
create table if not exists public.notification_prefs (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  prefs      jsonb not null default '{"follows":true,"comments":true,"likes":true,"requests":true}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
create policy notif_prefs_own on public.notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 7. Export + delete account.
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'posts', (select coalesce(jsonb_agg(to_jsonb(po)), '[]') from public.posts po where po.user_id = auth.uid()),
    'comments', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.comments c where c.user_id = auth.uid()),
    'following', (select coalesce(jsonb_agg(jsonb_build_object('followee', f.followee_id, 'status', f.status)), '[]') from public.follows f where f.follower_id = auth.uid()),
    'followers', (select coalesce(jsonb_agg(jsonb_build_object('follower', f.follower_id, 'status', f.status)), '[]') from public.follows f where f.followee_id = auth.uid()),
    'points_ledger', (select coalesce(jsonb_agg(to_jsonb(pl)), '[]') from public.points_ledger pl where pl.user_id = auth.uid()),
    'blocks', (select coalesce(jsonb_agg(b.blocked_id), '[]') from public.blocks b where b.blocker_id = auth.uid()),
    'mutes', (select coalesce(jsonb_agg(m.muted_id), '[]') from public.mutes m where m.muter_id = auth.uid()),
    'exported_at', now()
  );
$fn$;
revoke all on function public.export_my_data() from public;
grant execute on function public.export_my_data() to authenticated;

-- Full erasure: delete the auth user, which cascades every public row (profiles
-- FK is ON DELETE CASCADE, and all content FKs cascade from profiles). Owned by
-- the migration role so it can reach auth.users.
create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = '' as $fn$
declare _uid uuid := auth.uid();
begin
  if _uid is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = _uid;  -- cascades profiles → posts/comments/…
end;
$fn$;
revoke all on function public.delete_account() from public;
grant execute on function public.delete_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Public avatars bucket. Avatars are public profile media; readable by all,
--    writable only by the owner (path = {uid}/...).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public;

create policy avatars_read on storage.objects
  for select to authenticated, anon using (bucket_id = 'avatars');
create policy avatars_write_own on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update_own on storage.objects
  for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete_own on storage.objects
  for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

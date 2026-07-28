-- ============================================================================
-- 20260728090000_comments
-- Server side of the comment sheet: fetch, add, edit-is-client-side, delete
-- (with tombstones), and emoji reactions. All points go through award_points /
-- _award_to server-side; the client only ever reports an action.
--
-- ANONYMITY (§9): none of these functions read, order by, or expose swipes.
-- Comments are attributable (public), but a commenter's SWIPE stays invisible —
-- nothing here joins or references the swipes table.
--
-- Hardening: award_points was previously granted to `authenticated`, which let a
-- client fabricate awards by calling it directly. It is now revoked from
-- authenticated and reachable only through the action functions (record_swipe,
-- add_comment, toggle_reaction) which run SECURITY DEFINER and decide the delta.
-- ============================================================================

-- Tombstone marker: a top-level comment with replies is soft-deleted so the
-- thread survives. deleted_at is server-only (no client grant).
alter table public.comments add column if not exists deleted_at timestamptz;

-- ---------------------------------------------------------------------------
-- Lock award_points behind the action functions only.
-- ---------------------------------------------------------------------------
revoke execute on function public.award_points(text, text, uuid) from authenticated;

-- record_swipe must keep working now that it can't call award_points as the
-- invoker — make it SECURITY DEFINER (it already sets user_id = auth.uid()
-- explicitly and is idempotent, so bypassing RLS is safe).
create or replace function public.record_swipe(_post_id uuid, _direction text)
returns bigint
language plpgsql
security definer
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
-- Constants (inlined): reaction set, comment length rules.
--   allowed reactions : 👍 ❤️ 😂 😮 😢 🔥
--   max length        : 1000 chars
--   min scoring length: 2 chars trimmed (shorter comments post but don't score)
-- ---------------------------------------------------------------------------
create or replace function public.is_allowed_reaction(_emoji text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select _emoji in ('👍', '❤️', '😂', '😮', '😢', '🔥');
$fn$;
grant execute on function public.is_allowed_reaction(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- add_comment: insert a comment/reply and award the actor server-side.
-- SECURITY DEFINER; replicates the visibility checks RLS would apply.
-- ---------------------------------------------------------------------------
create or replace function public.add_comment(_post_id uuid, _body text, _parent_id uuid default null)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _uid    uuid := auth.uid();
  _clean  text := btrim(_body);
  _row    public.comments;
begin
  if _uid is null then
    raise exception 'add_comment: not authenticated';
  end if;
  if char_length(_clean) = 0 then
    raise exception 'add_comment: comment is empty';
  end if;
  if char_length(_clean) > 1000 then
    raise exception 'add_comment: comment is too long';
  end if;

  -- The post must be visible to this user (mirrors the posts SELECT policy).
  if not exists (
    select 1 from public.posts p
    where p.id = _post_id
      and p.moderation_status <> 'removed'
      and not public.is_blocked_with(p.user_id)
      and (
        p.user_id = _uid
        or (p.visibility = 'public' and p.moderation_status = 'approved')
        or (p.visibility = 'private' and public.is_accepted_follower_of(p.user_id))
      )
  ) then
    raise exception 'add_comment: post not available';
  end if;

  -- Replies are one level deep only, and must belong to the same post.
  if _parent_id is not null then
    if not exists (
      select 1 from public.comments c
      where c.id = _parent_id and c.post_id = _post_id and c.parent_comment_id is null
    ) then
      raise exception 'add_comment: invalid parent comment';
    end if;
  end if;

  insert into public.comments (post_id, user_id, parent_comment_id, body)
  values (_post_id, _uid, _parent_id, _clean)
  returning * into _row;

  -- Award the actor (server decides the delta). Minimum-length gate here; the
  -- daily/rate rules live in award_points. ref points at the comment, never a swipe.
  if char_length(_clean) >= 2 then
    perform public.award_points(
      case when _parent_id is null then 'comment' else 'comment_reply' end,
      'comment',
      _row.id
    );
  end if;

  return _row;
end;
$fn$;

revoke all on function public.add_comment(uuid, text, uuid) from public;
grant execute on function public.add_comment(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_comment: own comments only. Top-level with replies → tombstone; else
-- hard delete. Reverses the comment's points via a compensating ledger row.
-- Returns true if tombstoned, false if hard-deleted. SECURITY DEFINER.
-- ---------------------------------------------------------------------------
create or replace function public.delete_comment(_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _uid          uuid := auth.uid();
  _c            public.comments;
  _has_replies  boolean;
  _award        integer;
  _tombstoned   boolean := false;
begin
  select * into _c from public.comments where id = _comment_id;
  if _c.id is null then
    raise exception 'delete_comment: not found';
  end if;
  if _c.user_id <> _uid then
    raise exception 'delete_comment: not your comment';
  end if;
  if _c.deleted_at is not null then
    return true; -- already a tombstone; idempotent
  end if;

  -- Reverse the original award (comment / comment_reply) if one was made.
  select delta into _award
  from public.points_ledger
  where user_id = _uid
    and ref_type = 'comment'
    and ref_id = _comment_id
    and reason in ('comment', 'comment_reply')
  order by created_at desc
  limit 1;
  if _award is not null and _award <> 0 then
    perform public._award_to(_uid, -_award, 'comment_undo', 'comment', _comment_id);
  end if;

  _has_replies := exists (select 1 from public.comments r where r.parent_comment_id = _comment_id);

  if _c.parent_comment_id is null and _has_replies then
    -- Tombstone: keep the row so replies survive; scrub the content.
    update public.comments
      set deleted_at = now(), body = '[deleted]'
      where id = _comment_id;
    _tombstoned := true;
  else
    delete from public.comments where id = _comment_id;
  end if;

  return _tombstoned;
end;
$fn$;

revoke all on function public.delete_comment(uuid) from public;
grant execute on function public.delete_comment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- toggle_reaction: add/remove one emoji reaction on a comment. Awards on add,
-- reverses on remove (compensating row). Returns the resulting reacted state.
-- SECURITY DEFINER; the comment must be visible to the caller.
-- ---------------------------------------------------------------------------
create or replace function public.toggle_reaction(_comment_id uuid, _emoji text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _uid     uuid := auth.uid();
  _existed integer;
begin
  if _uid is null then
    raise exception 'toggle_reaction: not authenticated';
  end if;
  if not public.is_allowed_reaction(_emoji) then
    raise exception 'toggle_reaction: emoji not allowed';
  end if;

  -- Comment must be visible (post readable + not blocked) and not a tombstone.
  if not exists (
    select 1 from public.comments c
    join public.posts p on p.id = c.post_id
    where c.id = _comment_id
      and c.deleted_at is null
      and not public.is_blocked_with(c.user_id)
      and p.moderation_status <> 'removed'
      and (
        p.user_id = _uid
        or (p.visibility = 'public' and p.moderation_status = 'approved')
        or (p.visibility = 'private' and public.is_accepted_follower_of(p.user_id))
      )
  ) then
    raise exception 'toggle_reaction: comment not available';
  end if;

  delete from public.comment_reactions
  where comment_id = _comment_id and user_id = _uid and emoji = _emoji;
  get diagnostics _existed = row_count;

  if _existed > 0 then
    -- Removed: reverse the reaction award.
    perform public._award_to(
      _uid, -public.points_for_reason('comment_reaction'),
      'comment_reaction_undo', 'comment_reaction', _comment_id
    );
    return false;
  end if;

  insert into public.comment_reactions (comment_id, user_id, emoji)
  values (_comment_id, _uid, _emoji);
  perform public.award_points('comment_reaction', 'comment_reaction', _comment_id);
  return true;
end;
$fn$;

revoke all on function public.toggle_reaction(uuid, text) from public;
grant execute on function public.toggle_reaction(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_comments / get_replies: enriched, paginated reads. SECURITY INVOKER so
-- the existing comments/reactions RLS gates visibility (blocked users' comments
-- and reactions are filtered automatically). Ordered strictly by time — never
-- by anything swipe-derived.
-- ---------------------------------------------------------------------------
create or replace function public.get_comments(
  _post_id uuid,
  _limit integer default 20,
  _before timestamptz default null
)
returns table (
  id             uuid,
  post_id        uuid,
  user_id        uuid,
  parent_id      uuid,
  body           text,
  created_at     timestamptz,
  updated_at     timestamptz,
  is_deleted     boolean,
  is_own         boolean,
  author_handle  text,
  author_name    text,
  author_avatar  text,
  reply_count    bigint,
  reaction_counts jsonb,
  my_reactions   text[]
)
language sql
stable
security invoker
set search_path = public, extensions
as $fn$
  select
    c.id, c.post_id, c.user_id, c.parent_comment_id,
    case when c.deleted_at is not null then null else c.body end,
    c.created_at, c.updated_at,
    (c.deleted_at is not null),
    (c.user_id = auth.uid()),
    pr.handle, pr.display_name, pr.avatar_url,
    (select count(*) from public.comments r where r.parent_comment_id = c.id),
    coalesce((
      select jsonb_object_agg(emoji, n)
      from (select emoji, count(*) n from public.comment_reactions cr
            where cr.comment_id = c.id group by emoji) e
    ), '{}'::jsonb),
    coalesce((
      select array_agg(cr.emoji) from public.comment_reactions cr
      where cr.comment_id = c.id and cr.user_id = auth.uid()
    ), '{}')
  from public.comments c
  join public.profiles pr on pr.id = c.user_id
  where c.post_id = _post_id
    and c.parent_comment_id is null
    and (_before is null or c.created_at < _before)
  order by c.created_at desc
  limit greatest(_limit, 0);
$fn$;

grant execute on function public.get_comments(uuid, integer, timestamptz) to authenticated;

create or replace function public.get_replies(
  _parent_id uuid,
  _limit integer default 50,
  _after timestamptz default null
)
returns table (
  id             uuid,
  post_id        uuid,
  user_id        uuid,
  parent_id      uuid,
  body           text,
  created_at     timestamptz,
  updated_at     timestamptz,
  is_deleted     boolean,
  is_own         boolean,
  author_handle  text,
  author_name    text,
  author_avatar  text,
  reply_count    bigint,
  reaction_counts jsonb,
  my_reactions   text[]
)
language sql
stable
security invoker
set search_path = public, extensions
as $fn$
  select
    c.id, c.post_id, c.user_id, c.parent_comment_id,
    case when c.deleted_at is not null then null else c.body end,
    c.created_at, c.updated_at,
    (c.deleted_at is not null),
    (c.user_id = auth.uid()),
    pr.handle, pr.display_name, pr.avatar_url,
    0::bigint,
    coalesce((
      select jsonb_object_agg(emoji, n)
      from (select emoji, count(*) n from public.comment_reactions cr
            where cr.comment_id = c.id group by emoji) e
    ), '{}'::jsonb),
    coalesce((
      select array_agg(cr.emoji) from public.comment_reactions cr
      where cr.comment_id = c.id and cr.user_id = auth.uid()
    ), '{}')
  from public.comments c
  join public.profiles pr on pr.id = c.user_id
  where c.parent_comment_id = _parent_id
    and (_after is null or c.created_at > _after)
  order by c.created_at asc
  limit greatest(_limit, 0);
$fn$;

grant execute on function public.get_replies(uuid, integer, timestamptz) to authenticated;

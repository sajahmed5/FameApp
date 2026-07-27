-- ============================================================================
-- 20260727090800_onboarding
-- Support for the post-verification onboarding flow (tag selection + suggested
-- accounts).
--
--   1. profiles.onboarding_complete — routing flag. New signups default false
--      and are sent through onboarding; existing rows are backfilled true.
--   2. get_suggested_accounts() — ranks profiles whose PUBLIC posts carry the
--      user's selected tags (from user_tags), by tag overlap then follower
--      count, excluding self and any block relationship (either direction).
--      SECURITY DEFINER so it can aggregate follower counts / read the block
--      graph; it returns only public profile info + counts, no swipe data — so
--      it does not touch §9 anonymity (direct or indirect).
-- ============================================================================

-- 1. onboarding flag
alter table public.profiles
  add column if not exists onboarding_complete boolean not null default false;

-- Existing rows (seed users) are considered already onboarded.
update public.profiles set onboarding_complete = true where onboarding_complete = false;

-- The client marks its own onboarding done; add just this column to the update grant.
grant update (onboarding_complete) on public.profiles to authenticated;

-- 2. suggested accounts
create or replace function public.get_suggested_accounts(_limit integer default 20)
returns table (
  id             uuid,
  handle         text,
  display_name   text,
  avatar_url     text,
  is_private     boolean,
  follower_count bigint,
  overlap        bigint,
  follow_status  text
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with my_tags as (
    select tag_id from public.user_tags where user_id = auth.uid()
  ),
  candidate as (
    select distinct po.user_id, pt.tag_id
    from public.posts po
    join public.post_tags pt on pt.post_id = po.id
    where pt.tag_id in (select tag_id from my_tags)
      and po.visibility = 'public'
      and po.moderation_status = 'approved'
      and po.user_id <> auth.uid()
  ),
  scored as (
    select user_id, count(distinct tag_id) as overlap
    from candidate
    group by user_id
  )
  select
    p.id,
    p.handle,
    p.display_name,
    p.avatar_url,
    p.is_private,
    (select count(*) from public.follows f
       where f.followee_id = p.id and f.status = 'accepted') as follower_count,
    s.overlap,
    (select f.status from public.follows f
       where f.follower_id = auth.uid() and f.followee_id = p.id) as follow_status
  from scored s
  join public.profiles p on p.id = s.user_id
  where not exists (
    select 1 from public.blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
       or (b.blocker_id = p.id and b.blocked_id = auth.uid())
  )
  order by s.overlap desc, follower_count desc, p.handle asc
  limit greatest(_limit, 0);
$fn$;

revoke all on function public.get_suggested_accounts(integer) from public;
grant execute on function public.get_suggested_accounts(integer) to authenticated;

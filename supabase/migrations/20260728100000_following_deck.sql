-- ============================================================================
-- 20260728100000_following_deck
-- The Following tab's candidate pool + a summary for its empty states.
--
-- PRIVACY: get_following_deck only ever returns posts from accounts the caller
-- ACCEPTED-follows (the follows join requires status = 'accepted'). A private
-- post from a non-followed account, or from an account with only a PENDING
-- request, cannot appear — there is no matching follows row. It reads only the
-- caller's own swipes (for exclusion) and never exposes swipe attribution (§9).
--
-- Unranked by design: strictly newest-first, no points boost, no tag weighting.
-- ============================================================================

create or replace function public.get_following_deck(_limit integer default 20, _exclude uuid[] default '{}')
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
    join public.follows f
      on f.followee_id = p.user_id
     and f.follower_id = auth.uid()
     and f.status = 'accepted'
    where p.moderation_status = 'approved'
      -- both public and private: an accepted follower sees private posts here.
      and p.visibility in ('public', 'private')
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
  )
  select
    b.id, b.user_id, b.media_url, b.thumbnail_url, b.media_type, b.caption,
    b.alt_text, b.like_count, b.skip_count, b.comment_count, b.created_at,
    pr.handle, pr.display_name, pr.avatar_url,
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tags
  from base b
  join public.profiles pr on pr.id = b.user_id
  left join public.post_tags pt on pt.post_id = b.id
  left join public.tags t on t.id = pt.tag_id
  group by
    b.id, b.user_id, b.media_url, b.thumbnail_url, b.media_type, b.caption,
    b.alt_text, b.like_count, b.skip_count, b.comment_count, b.created_at,
    pr.handle, pr.display_name, pr.avatar_url
  order by b.created_at desc
  limit greatest(_limit, 0);
$fn$;

revoke all on function public.get_following_deck(integer, uuid[]) from public;
grant execute on function public.get_following_deck(integer, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- get_following_summary: lets the tab pick the right empty state.
--   following_count : accepted follows.
--   postable_count  : eligible posts from those accounts, IGNORING swipes
--                     (so "no posts yet" can be told apart from "caught up").
-- ---------------------------------------------------------------------------
create or replace function public.get_following_summary()
returns table (following_count integer, postable_count integer)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    (select count(*)::integer from public.follows f
       where f.follower_id = auth.uid() and f.status = 'accepted'),
    (select count(*)::integer
       from public.posts p
       join public.follows f
         on f.followee_id = p.user_id and f.follower_id = auth.uid() and f.status = 'accepted'
       where p.moderation_status = 'approved'
         and p.visibility in ('public', 'private')
         and p.user_id <> auth.uid()
         and not exists (
           select 1 from public.blocks b
           where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
              or (b.blocker_id = p.user_id and b.blocked_id = auth.uid())
         ));
$fn$;

revoke all on function public.get_following_summary() from public;
grant execute on function public.get_following_summary() to authenticated;

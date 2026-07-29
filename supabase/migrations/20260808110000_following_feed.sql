-- ============================================================================
-- 20260808110000_following_feed
--
-- A PERSISTENT, Instagram/TikTok-style feed for the Following tab. Unlike
-- get_following_deck (a swipe deck that consumes posts once swiped), this returns
-- ALL recent posts from accounts the caller accepted-follows, newest-first, and is
-- NOT filtered by the swipes table — so the feed doesn't empty out as you interact.
-- Cursor-paginated by created_at for infinite scroll.
--
-- PRIVACY: identical visibility rules to get_following_deck — only accepted-follow
-- posts, block/mute pairs excluded, removed/pending posts hidden.
-- ============================================================================

create or replace function public.get_following_feed(
  _limit  integer default 15,
  _before timestamptz default null
)
returns table (
  id uuid, user_id uuid, media_url text, thumbnail_url text, media_type text, caption text,
  alt_text text, like_count integer, skip_count integer, comment_count integer, created_at timestamptz,
  poster_handle text, poster_display_name text, poster_avatar_url text, tags text[]
) language sql stable security definer set search_path = '' as $fn$
  with base as (
    select p.id, p.user_id, p.media_url, p.thumbnail_url, p.media_type, p.caption,
           p.alt_text, p.like_count, p.skip_count, p.comment_count, p.created_at
    from public.posts p
    join public.follows f
      on f.followee_id = p.user_id and f.follower_id = auth.uid() and f.status = 'accepted'
    where p.moderation_status = 'approved'
      and p.visibility in ('public', 'private')
      and p.user_id <> auth.uid()
      and (_before is null or p.created_at < _before)
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
           or (b.blocker_id = p.user_id and b.blocked_id = auth.uid())
      )
      and not exists (
        select 1 from public.mutes m where m.muter_id = auth.uid() and m.muted_id = p.user_id
      )
  )
  select b.id, b.user_id, b.media_url, b.thumbnail_url, b.media_type, b.caption, b.alt_text,
    b.like_count, b.skip_count, b.comment_count, b.created_at,
    pr.handle, pr.display_name, pr.avatar_url,
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tags
  from base b
  join public.profiles pr on pr.id = b.user_id
  left join public.post_tags pt on pt.post_id = b.id
  left join public.tags t on t.id = pt.tag_id
  group by b.id, b.user_id, b.media_url, b.thumbnail_url, b.media_type, b.caption, b.alt_text,
    b.like_count, b.skip_count, b.comment_count, b.created_at, pr.handle, pr.display_name, pr.avatar_url
  order by b.created_at desc
  limit greatest(_limit, 0);
$fn$;

revoke all on function public.get_following_feed(integer, timestamptz) from public;
grant execute on function public.get_following_feed(integer, timestamptz) to authenticated;

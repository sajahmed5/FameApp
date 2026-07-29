-- ============================================================================
-- 20260808120000_my_swipes
--
-- Owner-only history of the caller's own swipes, so they can review what they
-- Liked (right) or Skipped (left) and change their mind (undo_swipe puts a post
-- back in play). SECURITY DEFINER + hard-scoped to auth.uid() — this NEVER exposes
-- anyone else's swipes (swipe anonymity, Rule 1). Removed posts are hidden.
-- ============================================================================

create or replace function public.get_my_swipes(
  _direction text,
  _limit     integer default 30,
  _before    timestamptz default null
)
returns table (
  post_id       uuid,
  thumbnail_url text,
  media_type    text,
  swiped_at     timestamptz
) language sql stable security definer set search_path = '' as $fn$
  select s.post_id, p.thumbnail_url, p.media_type, s.created_at
  from public.swipes s
  join public.posts p on p.id = s.post_id
  where s.user_id = auth.uid()
    and s.direction = _direction
    and p.moderation_status <> 'removed'
    and (_before is null or s.created_at < _before)
  order by s.created_at desc
  limit greatest(_limit, 0);
$fn$;

revoke all on function public.get_my_swipes(text, integer, timestamptz) from public;
grant execute on function public.get_my_swipes(text, integer, timestamptz) to authenticated;

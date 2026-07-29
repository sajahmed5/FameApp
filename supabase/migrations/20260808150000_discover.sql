-- ============================================================================
-- 20260808150000_discover
--
-- get_discover — content for the Search "Worldwide" default (no query) and any
-- browse-all surface. UNLIKE get_deck it does NOT exclude already-swiped posts, so
-- it never goes blank once you've swiped the deck. Ranked by:
--   affinity  (your tag interests — "mostly tags you engage with") ×3
--   recency   (recent, ~48h decay — "popular at this moment, not all-time")  ×2
--   heat      (ln(2 + like_count) — current popularity)                      ×1.5
-- Excludes your own posts and block pairs; public + approved only.
-- ============================================================================

create or replace function public.get_discover(_limit integer default 30)
returns table (
  id uuid, user_id uuid, media_url text, thumbnail_url text, media_type text, caption text,
  alt_text text, like_count integer, skip_count integer, comment_count integer, created_at timestamptz,
  poster_handle text, poster_display_name text, poster_avatar_url text, tags text[]
) language sql stable security definer set search_path = '' as $fn$
  with base as (
    select p.id, p.user_id, p.media_url, p.thumbnail_url, p.media_type, p.caption,
           p.alt_text, p.like_count, p.skip_count, p.comment_count, p.created_at
    from public.posts p
    where p.visibility = 'public'
      and p.moderation_status = 'approved'
      and p.user_id <> auth.uid()
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
      exp(-extract(epoch from (now() - b.created_at)) / (48.0 * 3600.0)) as recency,
      ln(2 + b.like_count) as heat
    from base b
  )
  select r.id, r.user_id, r.media_url, r.thumbnail_url, r.media_type, r.caption, r.alt_text,
    r.like_count, r.skip_count, r.comment_count, r.created_at,
    pr.handle, pr.display_name, pr.avatar_url,
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tags
  from ranked r
  join public.profiles pr on pr.id = r.user_id
  left join public.post_tags pt on pt.post_id = r.id
  left join public.tags t on t.id = pt.tag_id
  group by r.id, r.user_id, r.media_url, r.thumbnail_url, r.media_type, r.caption, r.alt_text,
    r.like_count, r.skip_count, r.comment_count, r.created_at, r.affinity, r.recency, r.heat,
    pr.handle, pr.display_name, pr.avatar_url
  order by (r.affinity * 3.0 + r.recency * 2.0 + r.heat * 1.5) desc
  limit greatest(_limit, 0);
$fn$;

revoke all on function public.get_discover(integer) from public;
grant execute on function public.get_discover(integer) to authenticated;

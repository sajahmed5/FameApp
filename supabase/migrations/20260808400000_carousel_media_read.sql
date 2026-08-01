-- ============================================================================
-- 20260808400000_carousel_media_read  (report #29 — carousel pages invisible
-- to everyone except the poster)
--
-- The media bucket's read policy grants non-owner access only when a
-- public.posts row references the EXACT object key (media_url/thumbnail_url).
-- Carousel extras live in public.post_media — added later — which the policy
-- never mentions. So the poster saw every page (owner clause) while everyone
-- else could only read the cover: signing pages 2..N failed for them.
--
-- Fix: the same visibility rules, applied to keys referenced from post_media
-- joined to the parent post. Blocks, moderation and private-follower gating
-- are identical to the cover's.
-- ============================================================================

drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.posts p
        where (p.media_url = storage.objects.name or p.thumbnail_url = storage.objects.name)
          and not public.is_blocked_with(p.user_id)
          and p.moderation_status <> 'removed'
          and (
            (p.visibility = 'public' and p.moderation_status = 'approved')
            or (p.visibility = 'private' and public.is_accepted_follower_of(p.user_id))
          )
      )
      or exists (
        select 1
        from public.post_media pm
        join public.posts p on p.id = pm.post_id
        where (pm.media_url = storage.objects.name or pm.thumbnail_url = storage.objects.name)
          and not public.is_blocked_with(p.user_id)
          and p.moderation_status <> 'removed'
          and (
            (p.visibility = 'public' and p.moderation_status = 'approved')
            or (p.visibility = 'private' and public.is_accepted_follower_of(p.user_id))
          )
      )
    )
  );

-- ============================================================================
-- 20260808320000_no_self_swipe  (fixes feedback #17)
--
-- Nothing stopped you liking or skipping your own post. That inflated your own
-- like/skip counts and, through the swipe-count trigger, your own points.
--
-- The post viewer now hides those controls on your own posts, but the client is
-- not the enforcement point: the insert policy is. Own rows only, as before, and
-- the post must belong to somebody else.
--
-- Verified before writing: no self-swipes exist yet, so no backfill is needed.
-- ============================================================================

drop policy if exists swipes_insert_own on public.swipes;
create policy swipes_insert_own on public.swipes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (
      select 1 from public.posts p
      where p.id = post_id
        and p.user_id = auth.uid()
    )
  );

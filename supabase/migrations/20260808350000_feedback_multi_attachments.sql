-- ============================================================================
-- 20260808350000_feedback_multi_attachments
--
-- A report could carry exactly one image. In practice a bug needs two or three
-- (before / after, or the same glitch on two screens), so attachments become a
-- list.
--
-- screenshot_path is KEPT and still written with the first attachment, so the
-- deployed admin portal keeps rendering something until it's updated to read
-- the array. Nothing is dropped and no existing row is rewritten.
-- ============================================================================

alter table public.feedback_reports
  add column if not exists screenshot_paths text[] not null default '{}';

comment on column public.feedback_reports.screenshot_paths is
  'Storage keys in the private feedback bucket, in the order the reporter added them. screenshot_path mirrors the first entry for backwards compatibility.';

-- Backfill so existing single-image reports read uniformly through the array.
update public.feedback_reports
   set screenshot_paths = array[screenshot_path]
 where screenshot_path is not null
   and cardinality(screenshot_paths) = 0;

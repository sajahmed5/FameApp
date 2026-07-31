-- ============================================================================
-- 20260808360000_feedback_paths_grant
--
-- 20260808350000 added feedback_reports.screenshot_paths but not the INSERT
-- grant for it. Column privileges are per-column: naming an ungranted column in
-- an INSERT fails the WHOLE statement, so filing any report broke outright
-- ("Could not send that report") rather than just losing its images.
-- ============================================================================

grant insert (screenshot_paths) on public.feedback_reports to authenticated;

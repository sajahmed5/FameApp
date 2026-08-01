-- ============================================================================
-- 20260808380000_anon_feedback_grant_fix
--
-- 20260808370000 revoked submit_anon_feedback from PUBLIC and granted it to
-- anon. That is not sufficient: Supabase's default privileges also grant EXECUTE
-- on new public-schema functions directly to `authenticated`, and a role-specific
-- grant survives a revoke from PUBLIC.
--
-- Left as-is, a signed-in user could call the anon path to file an UNATTRIBUTED
-- report and burn the shared IP rate limit. Signed-in reporting has its own
-- policy and does not need this function at all.
-- ============================================================================

revoke execute on function public.submit_anon_feedback(text, text, text, text, text)
  from authenticated;

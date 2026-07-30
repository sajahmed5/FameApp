-- ============================================================================
-- 20260808280000_harden_notification_fns
--
-- enqueue_notification and notify_mentions are SECURITY DEFINER helpers meant to
-- be called ONLY from database triggers — but Postgres grants EXECUTE to PUBLIC
-- by default, and PostgREST exposes them at /rpc. Any authenticated user could
-- therefore forge notifications (arbitrary recipient/actor/type — fake follows,
-- impersonation, spam bypassing the mention cap). Revoke direct execution;
-- triggers keep working (they run with the function owner's rights).
-- ============================================================================

revoke all on function public.enqueue_notification(uuid, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.notify_mentions(text, uuid, uuid, uuid) from public, anon, authenticated;

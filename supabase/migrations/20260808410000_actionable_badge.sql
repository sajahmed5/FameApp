-- ============================================================================
-- 20260808410000_actionable_badge  (feedback #28)
--
-- The bell counted every unread notification, so likes, milestones and
-- "accepted your request" inflated it until the number meant nothing. The
-- badge now counts only things you'd ACT on: follow requests, comments,
-- replies and mentions.
--
-- Deliberately excluded: 'message' (the Messages tab has its own badge —
-- counting it here would double-badge one event), 'new_follower',
-- 'follow_accepted', 'comment_reaction', 'reach_milestone', 'moderation'.
-- The inbox still lists everything; this only changes the number.
-- ============================================================================

create or replace function public.unread_notification_count()
returns integer language sql stable security definer set search_path = '' as $fn$
  select count(*)::int
  from public.notifications n
  where n.user_id = auth.uid()
    and n.read_at is null
    and n.type in ('follow_request', 'comment', 'reply', 'mention');
$fn$;

revoke all on function public.unread_notification_count() from public;
grant execute on function public.unread_notification_count() to authenticated;

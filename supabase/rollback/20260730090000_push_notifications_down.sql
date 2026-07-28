-- Rollback for 20260730090000_push_notifications

select cron.unschedule('reach-milestones') where exists (select 1 from cron.job where jobname = 'reach-milestones');

drop trigger if exists notification_dispatch on public.notifications;
drop trigger if exists notify_moderation on public.posts;
drop trigger if exists notify_reaction on public.comment_reactions;
drop trigger if exists notify_comment on public.comments;
drop trigger if exists notify_follow on public.follows;

drop function if exists public.tg_notification_dispatch();
drop function if exists public.mark_notifications_read(uuid[]);
drop function if exists public.unread_notification_count();
drop function if exists public.get_notifications(integer, timestamptz);
drop function if exists public.check_reach_milestones();
drop function if exists public.tg_notify_moderation();
drop function if exists public.tg_notify_reaction();
drop function if exists public.tg_notify_comment();
drop function if exists public.tg_notify_follow();
drop function if exists public.enqueue_notification(uuid, text, uuid, uuid, uuid, jsonb);

drop table if exists public.notifications;
drop table if exists public.push_tokens;
alter table public.posts drop column if exists last_milestone;
drop table if exists private.config;
-- extensions (pg_net, pg_cron) left installed — harmless.

-- Rollback for 20260729090000_profile

drop function if exists public.delete_account();
drop function if exists public.export_my_data();
drop table if exists public.notification_prefs;
drop function if exists public.get_tag_reach();
drop function if exists public.get_account_analytics();
drop function if exists public.get_post_analytics(uuid);
drop function if exists public.get_profile_overview(text);
drop function if exists public.is_muting(uuid);
drop table if exists public.mutes;
drop function if exists public.record_share(uuid);
-- Note: get_deck / get_following_deck / tg_swipes_counts are left in their
-- updated form (harmless); re-apply the prior migration to fully revert them.
alter table public.posts drop column if exists share_count;

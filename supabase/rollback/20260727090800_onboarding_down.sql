-- Rollback for 20260727090800_onboarding

drop function if exists public.get_suggested_accounts(integer);
alter table public.profiles drop column if exists onboarding_complete;

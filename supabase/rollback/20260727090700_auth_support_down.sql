-- Rollback for 20260727090700_auth_support

drop function if exists public.is_handle_available(text);
drop trigger if exists profiles_age_band on public.profiles;
drop function if exists public.tg_profiles_age_band();
alter table public.profiles drop column if exists age_band;

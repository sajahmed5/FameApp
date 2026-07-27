-- ============================================================================
-- 20260727090700_auth_support
-- Support for the authentication / signup flow.
--
--   1. profiles.age_band — a coarse 'minor' | 'adult' band derived from DOB, so
--      later features gate on age without re-deriving DOB everywhere. It is
--      SERVER-COMPUTED by a trigger (never client-set) and immutable-by-derivation
--      — the client has no INSERT/UPDATE grant on it, matching the DOB lockdown.
--   2. A hard DB-level under-13 block: inserting a profile with DOB < 13y raises.
--   3. public.is_handle_available(text) — an anon-callable check so the signup
--      screen can validate handle availability BEFORE an auth user exists.
-- ============================================================================

-- 1. age_band column (nullable first so we can backfill existing seed rows).
alter table public.profiles
  add column if not exists age_band text check (age_band in ('minor', 'adult'));

-- Backfill existing rows from their DOB.
update public.profiles
   set age_band = case
     when date_of_birth <= (current_date - interval '18 years') then 'adult'
     else 'minor'
   end
 where age_band is null;

alter table public.profiles alter column age_band set not null;

-- 2. Derive age_band on write, and enforce the 13+ minimum at the database.
create or replace function public.tg_profiles_age_band()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _years integer := extract(year from age(new.date_of_birth))::integer;
begin
  if _years < 13 then
    raise exception 'Account holders must be at least 13 years old'
      using errcode = 'check_violation';
  end if;
  new.age_band := case when _years < 18 then 'minor' else 'adult' end;
  return new;
end;
$fn$;

-- Fires before the updated_at trigger alphabetically ('age_band' < 'set_updated');
-- order does not matter here since they touch different columns.
create trigger profiles_age_band
  before insert or update on public.profiles
  for each row execute function public.tg_profiles_age_band();

-- 3. Handle availability, callable by anon (pre-auth signup) and authenticated.
--    Returns true only when the handle is well-formed AND not already taken.
--    SECURITY DEFINER so it can read profiles under RLS; it returns a single
--    boolean and leaks nothing beyond "is this public handle in use".
create or replace function public.is_handle_available(_handle text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select _handle ~ '^[a-z0-9_]{3,30}$'
     and not exists (select 1 from public.profiles where handle = _handle);
$fn$;

revoke all on function public.is_handle_available(text) from public;
grant execute on function public.is_handle_available(text) to anon, authenticated;

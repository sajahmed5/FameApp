-- ============================================================================
-- 20260727090100_extensions
-- Required Postgres extensions.
--   pgcrypto : gen_salt/crypt for the seed script (password hashing).
--   postgis  : geography(Point) type for profiles.search_location.
-- On Supabase these live in the dedicated `extensions` schema.
-- ============================================================================

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;

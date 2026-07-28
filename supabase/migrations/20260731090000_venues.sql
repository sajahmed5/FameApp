-- ============================================================================
-- 20260731090000_venues — venue/place tagging M1 (backend).
-- See docs/venue-tagging-design.md.
--
-- PRIVACY: we store the PUBLIC venue (a business's own, public location), never
-- the user's raw GPS. Venues are global and de-duped by (provider, place id).
-- Venue tagging is hidden for minors — enforced server-side here (trigger) and
-- in the `places` Edge Function, not just the UI.
-- ============================================================================

create table if not exists public.venues (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,               -- 'google' | ...
  provider_place_id text not null,               -- provider's stable place id
  name              text not null,
  category          text,                         -- normalised primary type, e.g. 'restaurant'
  lat               double precision,             -- the VENUE's public location (not the user's)
  lon               double precision,
  address           text,
  location_cell     text,                         -- coarse geohash of the venue
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (provider, provider_place_id)
);
create index if not exists venues_location_cell on public.venues (location_cell);

alter table public.venues enable row level security;
-- Public place data: any signed-in user may read. Writes only via the Edge
-- Function (service_role) after fetching authoritative Place Details.
create policy venues_select on public.venues for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- posts.venue_id — a post may tag one venue. ON DELETE SET NULL so removing a
-- venue never deletes posts.
-- ---------------------------------------------------------------------------
alter table public.posts add column if not exists venue_id uuid references public.venues (id) on delete set null;
create index if not exists posts_venue_id on public.posts (venue_id) where venue_id is not null;

-- Owner may set/clear venue_id (RLS posts_update already restricts to owner; the
-- FK guarantees it points at a real venue). The Edge Function sets new venues
-- via service_role; this grant lets the edit screen clear or reuse a venue.
grant update (venue_id) on public.posts to authenticated;

-- Minor gate backstop: whatever the path (client grant OR the Edge Function),
-- a minor's post can never carry a venue. The `places` function also rejects
-- minors up front with a clear message.
create or replace function public.tg_posts_minor_venue_gate()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.venue_id is not null
     and (select age_band from public.profiles where id = new.user_id) = 'minor' then
    new.venue_id := null;
  end if;
  return new;
end;
$fn$;
drop trigger if exists posts_minor_venue_gate on public.posts;
create trigger posts_minor_venue_gate before insert or update of venue_id on public.posts
  for each row execute function public.tg_posts_minor_venue_gate();

-- ---------------------------------------------------------------------------
-- Per-user rate limit for the `places` function (Google Places calls cost).
-- ---------------------------------------------------------------------------
create table if not exists public.places_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists places_events_user_time on public.places_events (user_id, created_at desc);
alter table public.places_events enable row level security;  -- no policies → function/service only

create or replace function public.claim_places_slot(_max integer, _window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare _uid uuid := auth.uid(); _count integer;
begin
  if _uid is null then return false; end if;
  insert into public.places_events (user_id) values (_uid);
  select count(*) into _count from public.places_events
    where user_id = _uid and created_at > now() - make_interval(secs => _window_seconds);
  return _count <= _max;
end;
$fn$;
revoke all on function public.claim_places_slot(integer, integer) from public;
grant execute on function public.claim_places_slot(integer, integer) to authenticated;

create or replace function public.prune_places_events(_older_than_seconds integer default 86400)
returns integer language plpgsql security definer set search_path = '' as $fn$
declare _n integer;
begin
  delete from public.places_events where created_at < now() - make_interval(secs => _older_than_seconds);
  get diagnostics _n = row_count; return _n;
end;
$fn$;
revoke all on function public.prune_places_events(integer) from public;
grant execute on function public.prune_places_events(integer) to service_role;

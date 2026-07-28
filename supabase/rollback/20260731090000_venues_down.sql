-- Rollback for 20260731090000_venues

drop function if exists public.prune_places_events(integer);
drop function if exists public.claim_places_slot(integer, integer);
drop table if exists public.places_events;
drop trigger if exists posts_minor_venue_gate on public.posts;
drop function if exists public.tg_posts_minor_venue_gate();
alter table public.posts drop column if exists venue_id;
drop table if exists public.venues;

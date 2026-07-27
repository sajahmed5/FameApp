-- ============================================================================
-- 20260727090600_points_award
-- Server-authoritative points awarding.
--
-- Clients never write points_ledger directly (see migration 5). They call
-- public.award_points(reason, ...) and the SERVER decides the delta. This is the
-- single choke point where the anti-gaming rules will live (dwell-time gating,
-- per-hour diminishing returns, daily caps); the structure below marks exactly
-- where each rule slots in.
--
-- PERMANENT INVARIANT (swipe anonymity — Rule 1): a swipe only ever awards the
-- SWIPER, in their OWN ledger, referencing their own swipe. No award path here —
-- now or ever — may credit a POST OWNER for a swipe on their post: that would put
-- a swipe-referencing row in the owner's readable ledger and leak attribution.
-- The reason whitelist deliberately has no swipe "…_received" reason. Keep it so.
-- ============================================================================

-- Base point values per action (spec §8). Single source of truth; anti-gaming
-- multipliers are applied on top inside award_points, not here.
create or replace function public.points_for_reason(_reason text)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select case _reason
    when 'swipe'            then 1   -- left or right, deliberately equal
    when 'comment'          then 5
    when 'comment_reply'    then 5
    when 'comment_reaction' then 2
    else null                        -- unknown / not self-awardable
  end;
$fn$;

-- Internal: write a ledger row for an arbitrary user. NOT client-callable
-- (execute revoked below). Cross-user awards — e.g. the +3 a post owner earns
-- when they RECEIVE a comment (never a swipe) — and admin corrections go through
-- here. Awarding for a swipe must always target the swiper, never the owner.
create or replace function public._award_to(
  _user_id  uuid,
  _delta    integer,
  _reason   text,
  _ref_type text default null,
  _ref_id   uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if _user_id is null then
    raise exception '_award_to: user_id is required';
  end if;
  if _delta = 0 then
    return;                          -- nothing to record
  end if;
  insert into public.points_ledger (user_id, delta, reason, ref_type, ref_id)
  values (_user_id, _delta, _reason, _ref_type, _ref_id);
end;
$fn$;

-- Client entry point: award the CURRENT user for an action they just performed.
-- The client submits only the action (reason + optional ref); the server derives
-- the delta. Returns the user's new points_balance.
create or replace function public.award_points(
  _reason   text,
  _ref_type text default null,
  _ref_id   uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _user_id uuid := auth.uid();
  _base    integer;
  _delta   integer;
  _balance bigint;
begin
  if _user_id is null then
    raise exception 'award_points: not authenticated';
  end if;

  _base := public.points_for_reason(_reason);
  if _base is null then
    raise exception 'award_points: reason % is not awardable', _reason;
  end if;

  -- ===== anti-gaming pipeline (stubs; currently pass-through) ================
  -- Every gate is evaluated HERE, server-side, so no client can bypass it. Each
  -- can reduce the award (down to 0). Wire them in later against real behaviour:
  --   1. dwell-time gate    — for 'swipe', require min card dwell (~0.5s) else 0
  --   2. diminishing returns — first 50 swipes/rolling-hour full, next 50 half,
  --                            then 0 (query recent points_ledger for this user)
  --   3. daily earn ceiling  — clamp so today's positive total <= the cap
  --   4. min comment length  — caller passes only validated actions; enforce here
  _delta := _base;
  -- ==========================================================================

  if _delta <> 0 then
    perform public._award_to(_user_id, _delta, _reason, _ref_type, _ref_id);
  end if;

  select points_balance into _balance from public.profiles where id = _user_id;
  return _balance;
end;
$fn$;

-- Grants: only the public entry point (and the pure lookup) are client-callable.
-- award_points runs as owner, so it can still call _award_to internally even
-- though clients cannot.
revoke all on function public.points_for_reason(text)                   from public;
revoke all on function public._award_to(uuid, integer, text, text, uuid) from public;
revoke all on function public.award_points(text, text, uuid)            from public;

grant execute on function public.points_for_reason(text)                 to authenticated, service_role;
grant execute on function public.award_points(text, text, uuid)          to authenticated, service_role;
grant execute on function public._award_to(uuid, integer, text, text, uuid) to service_role;

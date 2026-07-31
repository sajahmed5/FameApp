-- ============================================================================
-- 20260808310000_follow_approval  (fixes feedback #3 and #4)
--
-- Follow approval was welded to profile privacy: a public profile auto-accepted
-- every follower, so "private" posts were visible to ANYONE who followed, not to
-- a vetted set. Being discoverable and vetting your followers are two different
-- choices, so they get two different switches.
--
-- profiles.require_follow_approval (default TRUE, including for existing rows)
-- now decides. A follow is only auto-accepted when the target is BOTH public and
-- not requiring approval; everything else lands as 'pending'.
--
-- The client no longer picks the status: it always inserts 'pending' and a BEFORE
-- INSERT trigger upgrades it when allowed. RLS still permits both values under the
-- same condition (WITH CHECK is evaluated after BEFORE triggers, so the policy and
-- the trigger must agree) — a client still cannot force itself an accepted follow.
-- ============================================================================

alter table public.profiles
  add column if not exists require_follow_approval boolean not null default true;

comment on column public.profiles.require_follow_approval is
  'When true (the default), new followers must be approved even if the profile is public.';

-- Owner-settable, like the other profile preferences.
grant update (require_follow_approval) on public.profiles to authenticated;

-- Auto-accept only for public profiles that have opted out of approving followers.
create or replace function public.tg_follow_autoaccept()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.status = 'pending' and exists (
    select 1 from public.profiles pr
    where pr.id = new.followee_id
      and pr.is_private = false
      and pr.require_follow_approval = false
  ) then
    new.status := 'accepted';
  end if;
  return new;
end $fn$;

drop trigger if exists follow_autoaccept on public.follows;
create trigger follow_autoaccept before insert on public.follows
  for each row execute function public.tg_follow_autoaccept();

-- Rebuild the insert policy so 'accepted' is only reachable via the same condition
-- the trigger uses (previously it keyed on is_private alone).
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows
  for insert to authenticated
  with check (
    follower_id = auth.uid()
    and not public.is_blocked_with(followee_id)
    and (
      status = 'pending'
      or (status = 'accepted'
          and exists (select 1 from public.profiles pr
                       where pr.id = followee_id
                         and pr.is_private = false
                         and pr.require_follow_approval = false))
    )
  );

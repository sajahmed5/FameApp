-- ============================================================================
-- 20260808330000_follow_autoaccept_default
--
-- 20260808310000 introduced require_follow_approval defaulting to TRUE, which
-- made EVERY follow a pending request — including on public profiles, and with
-- no setting to change it (the toggle shipped in the same commit as a build that
-- was never released). That is not the intent: a follow is only a request when
-- the owner has turned "Automatically accept followers" off.
--
-- So the default flips. Private accounts are unaffected: the auto-accept trigger
-- already requires is_private = false, so they keep approving every follower.
--
-- The backfill is safe because no user could have set this deliberately — the
-- settings toggle was never in a shipped build when this ran.
-- ============================================================================

alter table public.profiles
  alter column require_follow_approval set default false;

update public.profiles
   set require_follow_approval = false
 where require_follow_approval;

comment on column public.profiles.require_follow_approval is
  'When true, new followers must be approved even on a public profile. Defaults to false; a private account always approves regardless of this flag.';

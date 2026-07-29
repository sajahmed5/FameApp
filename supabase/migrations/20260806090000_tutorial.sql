-- ============================================================================
-- 20260806090000_tutorial
-- First-run tutorial completion flag on the profile.
--
--   profiles.tutorial_complete — the interactive first-run tutorial (swipe cards
--   + points explainer) is shown ONCE after onboarding. Storing completion on the
--   profile (not just locally) means it never repeats, even on a reinstall or a
--   new device. New signups default false; existing/seed rows are backfilled true
--   so the tutorial does not pop for accounts that predate it.
--
-- Mirrors the onboarding_complete pattern (20260727090800): a plain boolean the
-- client sets on its own row via a column-level UPDATE grant. It carries no
-- engagement data, so it does not touch §9 swipe anonymity.
-- ============================================================================

alter table public.profiles
  add column if not exists tutorial_complete boolean not null default false;

-- Existing rows (seed users + anyone who onboarded before this shipped) skip it.
update public.profiles set tutorial_complete = true where tutorial_complete = false;

-- The client marks its own tutorial done; add just this column to the update grant.
grant update (tutorial_complete) on public.profiles to authenticated;

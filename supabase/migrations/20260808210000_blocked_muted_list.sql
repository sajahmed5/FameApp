-- ============================================================================
-- 20260808210000_blocked_muted_list
--
-- The "Blocked & muted" settings screen read the blocked/muted users by joining
-- the profiles table from the client (`blocks -> profiles!fk`). But profiles is
-- RLS-protected, so a blocked user's profile row isn't visible to the blocker via
-- a normal embedded join — the join yielded null and the blocked user silently
-- vanished from the list, making blocks impossible to see or undo from the UI.
--
-- Fix: an owner-scoped SECURITY DEFINER RPC that returns the profile fields for
-- the caller's own blocked + muted users, bypassing the profiles RLS the same way
-- the rest of the app's read RPCs do.
-- ============================================================================

create or replace function public.get_blocked_muted()
returns table (kind text, id uuid, handle text, display_name text, avatar_url text)
language sql stable security definer set search_path = '' as $fn$
  select 'block'::text, p.id, p.handle, p.display_name, p.avatar_url
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  union all
  select 'mute'::text, p.id, p.handle, p.display_name, p.avatar_url
  from public.mutes m
  join public.profiles p on p.id = m.muted_id
  where m.muter_id = auth.uid();
$fn$;
revoke all on function public.get_blocked_muted() from public;
grant execute on function public.get_blocked_muted() to authenticated;

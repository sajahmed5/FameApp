-- ============================================================================
-- 20260808340000_change_handle  (feedback #14 — "How can I change username?")
--
-- Renaming is mechanically trivial (handle was already in the profiles update
-- grant) and semantically dangerous, because mentions are stored as RAW TEXT in
-- captions and comment bodies and resolved by handle at write time. Rename
-- naively and every existing "@oldhandle" becomes a dead link — and worse, if
-- somebody else later registers that handle, those old mentions silently start
-- pointing at a different person. That is an impersonation vector, not a typo.
--
-- So:
--   1. handle_history permanently RESERVES every released handle. Nobody else
--      can ever take it. Only the original owner can reclaim it.
--   2. get_profile_overview resolves through the history, so old links and old
--      @mentions still reach the right profile instead of 404ing.
--   3. A 30-day cooldown, so a handle can't be cycled to dodge moderation or
--      to squat names.
--   4. Direct UPDATE of profiles.handle is revoked. change_handle() is the only
--      path, so none of the above can be bypassed by a crafted client call.
-- ============================================================================

create table if not exists public.handle_history (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  handle      text not null,
  released_at timestamptz not null default now(),
  constraint handle_history_format check (handle ~ '^[a-z0-9_]{3,30}$')
);

-- One row per handle, forever: this IS the reservation.
create unique index if not exists handle_history_handle_idx
  on public.handle_history (handle);
create index if not exists handle_history_user_idx
  on public.handle_history (user_id);

-- RLS on with no policies: only the SECURITY DEFINER functions below may read it.
alter table public.handle_history enable row level security;

alter table public.profiles
  add column if not exists handle_changed_at timestamptz;

comment on column public.profiles.handle_changed_at is
  'When the handle was last changed. Drives the rename cooldown in change_handle().';

-- ---------------------------------------------------------------------------
-- The only way to rename. SECURITY DEFINER so it can write the reservation.
-- ---------------------------------------------------------------------------
create or replace function public.change_handle(_new text)
returns text language plpgsql security definer set search_path = '' as $fn$
declare
  _uid  uuid := auth.uid();
  _old  text;
  _last timestamptz;
begin
  if _uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  _new := lower(btrim(coalesce(_new, '')));

  if _new !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'Handles are 3–30 characters: lowercase letters, numbers, underscore.'
      using errcode = '22023';
  end if;

  -- Lock the row so two concurrent renames can't both pass the checks below.
  select p.handle, p.handle_changed_at into _old, _last
    from public.profiles p where p.id = _uid for update;

  if _old is null then
    raise exception 'No profile for this account.' using errcode = 'P0002';
  end if;
  if _new = _old then
    return _old;
  end if;

  if _last is not null and _last > now() - interval '30 days' then
    raise exception 'You can change your handle again after %.',
      to_char(_last + interval '30 days', 'FMDD Mon YYYY') using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles p where p.handle = _new) then
    raise exception 'That handle is taken.' using errcode = '23505';
  end if;

  -- Somebody else's released handle stays theirs, permanently.
  if exists (
    select 1 from public.handle_history h
    where h.handle = _new and h.user_id <> _uid
  ) then
    raise exception 'That handle is taken.' using errcode = '23505';
  end if;

  -- Reclaiming one of your own former handles: release the reservation.
  delete from public.handle_history h where h.handle = _new and h.user_id = _uid;

  insert into public.handle_history (user_id, handle) values (_uid, _old)
    on conflict (handle) do update
      set user_id = excluded.user_id, released_at = now();

  update public.profiles
     set handle = _new, handle_changed_at = now()
   where id = _uid;

  return _new;
end $fn$;

revoke all on function public.change_handle(text) from public;
grant execute on function public.change_handle(text) to authenticated;

-- Close the direct path. INSERT still needs handle (signup); UPDATE no longer does.
revoke update (handle) on public.profiles from authenticated;

-- ---------------------------------------------------------------------------
-- Availability must respect reservations, or the rename screen would offer a
-- handle that change_handle() then refuses.
-- ---------------------------------------------------------------------------
create or replace function public.is_handle_available(_handle text)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select _handle ~ '^[a-z0-9_]{3,30}$'
     and not exists (select 1 from public.profiles where handle = _handle)
     -- auth.uid() is null for anon signup, so every reserved handle reads as taken.
     and not exists (
       select 1 from public.handle_history h
       where h.handle = _handle and h.user_id is distinct from auth.uid()
     );
$fn$;
grant execute on function public.is_handle_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Resolve old handles, so a stale /u/<handle> link or an old @mention in a
-- caption still lands on the person who wrote it. Body is otherwise unchanged
-- from 20260729090000.
-- ---------------------------------------------------------------------------
create or replace function public.get_profile_overview(_handle text)
returns table (
  id uuid, handle text, display_name text, bio text, avatar_url text, is_private boolean,
  follower_count integer, following_count integer, post_count integer,
  is_self boolean, follow_status text, is_blocked boolean, is_muting boolean, locked boolean
) language sql stable security definer set search_path = '' as $fn$
  with resolved as (
    select coalesce(
      (select pr.id from public.profiles pr where pr.handle = _handle),
      (select h.user_id from public.handle_history h where h.handle = _handle)
    ) as id
  ),
  p as (select * from public.profiles where id = (select id from resolved))
  select p.id, p.handle, p.display_name, p.bio, p.avatar_url, p.is_private,
    (select count(*)::int from public.follows f where f.followee_id = p.id and f.status = 'accepted'),
    (select count(*)::int from public.follows f where f.follower_id = p.id and f.status = 'accepted'),
    (select count(*)::int from public.posts po where po.user_id = p.id and po.moderation_status <> 'removed'),
    (p.id = auth.uid()) as is_self,
    (select f.status from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id) as follow_status,
    public.is_blocked_with(p.id) as is_blocked,
    public.is_muting(p.id) as is_muting,
    (p.is_private and p.id <> auth.uid()
       and not exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id and f.status = 'accepted')) as locked
  from p;
$fn$;
revoke all on function public.get_profile_overview(text) from public;
grant execute on function public.get_profile_overview(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Mentions resolve at write time, so a renamed user should still be reachable
-- by their old handle in newly-written text too.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_handle(_handle text)
returns uuid language sql stable security definer set search_path = '' as $fn$
  select coalesce(
    (select pr.id from public.profiles pr where pr.handle = lower(_handle)),
    (select h.user_id from public.handle_history h where h.handle = lower(_handle))
  );
$fn$;
revoke all on function public.resolve_handle(text) from public;
grant execute on function public.resolve_handle(text) to authenticated;

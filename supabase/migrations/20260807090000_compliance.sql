-- ============================================================================
-- 20260807090000_compliance
-- Compliance surface: terms-acceptance record on the profile, and an appeals
-- table + client submit RPC for contesting moderation actions.
--
--   1. profiles.terms_version / terms_accepted_at — which version of the Terms +
--      Privacy Policy the user accepted, and when. Client-written at signup (and
--      on a re-accept when the version changes), so a column-level UPDATE grant.
--   2. appeals — a user contesting a removal/action. Mirrors `reports`: owner
--      INSERT (via RPC) + owner SELECT only; no client UPDATE/DELETE (admins
--      resolve via the service role). Overturning is audit-logged in the admin app.
--   3. submit_appeal() — SECURITY DEFINER: only lets a user appeal content that is
--      actually theirs AND actually actioned, and blocks duplicate open appeals.
-- ============================================================================

-- 1. terms acceptance --------------------------------------------------------
alter table public.profiles
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz;

-- The client records its own acceptance (version + time). Grant just these columns.
grant update (terms_version, terms_accepted_at) on public.profiles to authenticated;

-- 2. appeals -----------------------------------------------------------------
create table if not exists public.appeals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  target_type  text not null check (target_type in ('post', 'comment', 'account')),
  target_id    uuid not null,           -- post id / comment id / the user's own id
  reason       text not null,
  status       text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  submitted_at timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users(id),
  resolution_note text
);

create index if not exists appeals_status_idx on public.appeals (status, submitted_at desc);
create index if not exists appeals_user_idx on public.appeals (user_id);
-- At most one OPEN appeal per target (partial unique).
create unique index if not exists appeals_one_open_idx
  on public.appeals (target_type, target_id) where status = 'open';

alter table public.appeals enable row level security;

-- Owner may read their own appeals; nobody may INSERT/UPDATE/DELETE directly
-- (inserts go through submit_appeal; resolution is service-role only).
drop policy if exists appeals_read_own on public.appeals;
create policy appeals_read_own on public.appeals
  for select using (user_id = auth.uid());

revoke insert, update, delete on public.appeals from anon, authenticated;

-- 3. submit_appeal -----------------------------------------------------------
create or replace function public.submit_appeal(
  _target_type text,
  _target_id uuid,
  _reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _uid uuid := auth.uid();
  _ok boolean := false;
  _id uuid;
begin
  if _uid is null then raise exception 'not authenticated'; end if;
  if _reason is null or length(btrim(_reason)) < 3 then
    raise exception 'appeal reason required';
  end if;

  -- The user may only appeal their OWN content, and only when it is actually
  -- actioned (a removed/flagged post, a deleted comment, or a non-active account).
  if _target_type = 'post' then
    select true into _ok from public.posts
      where id = _target_id and user_id = _uid
        and moderation_status in ('removed', 'flagged');
  elsif _target_type = 'comment' then
    select true into _ok from public.comments
      where id = _target_id and user_id = _uid and deleted_at is not null;
  elsif _target_type = 'account' then
    _ok := (_target_id = _uid)
       and exists (select 1 from public.profiles
                    where id = _uid and account_status <> 'active');
  else
    raise exception 'invalid target_type';
  end if;

  if not _ok then
    raise exception 'nothing to appeal for this target';
  end if;

  insert into public.appeals (user_id, target_type, target_id, reason)
  values (_uid, _target_type, _target_id, btrim(_reason))
  returning id into _id;
  return _id;
exception
  when unique_violation then
    raise exception 'an appeal for this is already under review';
end;
$fn$;

revoke all on function public.submit_appeal(text, uuid, text) from public;
grant execute on function public.submit_appeal(text, uuid, text) to authenticated;

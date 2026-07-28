-- ============================================================================
-- 20260728110000_media_pipeline
-- Storage + supporting objects for the media upload Edge Function
-- (supabase/functions/media-pipeline).
--
-- Buckets (both PRIVATE — nothing is ever world-readable):
--   media-staging : private landing zone for the raw upload while it is
--                   processed. Objects are deleted once processing finishes or
--                   fails, so nothing is orphaned.
--   media         : the serving bucket. Still private; readability is governed
--                   by RLS that MIRRORS public.posts (public+approved → anyone
--                   verified; private → accepted followers only; owner always).
--                   Clients read via short-lived signed URLs, never public URLs.
--
-- Also: a per-user upload rate limiter, callable by the authenticated caller.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Buckets. file_size_limit / allowed_mime_types are defence-in-depth; the
--    Edge Function additionally validates the type by content inspection and
--    enforces its own size limits before anything is written.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media-staging', 'media-staging', false, 104857600,   -- 100 MB hard ceiling
     array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime']),
  ('media',         'media',         false, 104857600,
     array['image/jpeg','image/webp','video/mp4'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Storage RLS. storage.objects already has RLS enabled by Supabase.
--    Object key convention (set by the Edge Function):
--        {owner_uuid}/{media_id}.{ext}            display image / video
--        {owner_uuid}/{media_id}_thumb.{ext}      thumbnail / poster frame
--    The first path segment is the owner id, so ownership is provable from the
--    key without a DB lookup.
-- ---------------------------------------------------------------------------

-- media-staging: only the owner (or service_role, which bypasses RLS) may
-- touch their own staging objects. No cross-user access at all.
create policy media_staging_owner_all on storage.objects
  for all to authenticated
  using (bucket_id = 'media-staging' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'media-staging' and (storage.foldername(name))[1] = auth.uid()::text);

-- media (serving) READ: mirror public.posts visibility exactly.
--   * owner always;
--   * otherwise there must be a NON-removed post that references this exact
--     object key and is either public+approved, or private with the caller an
--     accepted follower — and the owner must not be in a block pair with the
--     caller. Until a post row exists, only the owner can read (unattached
--     media is private by construction).
create policy media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.posts p
        where (p.media_url = storage.objects.name or p.thumbnail_url = storage.objects.name)
          and not public.is_blocked_with(p.user_id)
          and p.moderation_status <> 'removed'
          and (
            (p.visibility = 'public' and p.moderation_status = 'approved')
            or (p.visibility = 'private' and public.is_accepted_follower_of(p.user_id))
          )
      )
    )
  );

-- media WRITE/DELETE: owner-only (service_role bypasses RLS for the pipeline).
create policy media_write_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy media_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy media_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 3. Per-user upload rate limit. Append-only event log + a SECURITY DEFINER
--    claim function that records the attempt and reports whether the caller is
--    within the window budget. Uses auth.uid(), so the Edge Function must call
--    it with the caller's JWT (not the service key).
-- ---------------------------------------------------------------------------
create table if not exists public.media_upload_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists media_upload_events_user_time
  on public.media_upload_events (user_id, created_at desc);

alter table public.media_upload_events enable row level security;
-- No policies → authenticated/anon get no direct access; only the SECURITY
-- DEFINER function below (and service_role) can touch it.

create or replace function public.claim_media_upload_slot(_max integer, _window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _uid   uuid := auth.uid();
  _count integer;
begin
  if _uid is null then
    return false;
  end if;
  insert into public.media_upload_events (user_id) values (_uid);
  select count(*) into _count
    from public.media_upload_events
   where user_id = _uid
     and created_at > now() - make_interval(secs => _window_seconds);
  return _count <= _max;
end;
$fn$;

revoke all on function public.claim_media_upload_slot(integer, integer) from public;
grant execute on function public.claim_media_upload_slot(integer, integer) to authenticated;

-- Housekeeping helper (optional cron): prune old rate-limit rows.
create or replace function public.prune_media_upload_events(_older_than_seconds integer default 86400)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare _n integer;
begin
  delete from public.media_upload_events
    where created_at < now() - make_interval(secs => _older_than_seconds);
  get diagnostics _n = row_count;
  return _n;
end;
$fn$;

revoke all on function public.prune_media_upload_events(integer) from public;
grant execute on function public.prune_media_upload_events(integer) to service_role;

-- ============================================================================
-- 20260728120000_post_moderation_verdict
-- Carry the media pipeline's moderation verdict onto the post the client creates.
--
-- The client CANNOT set posts.moderation_status (revoked in RLS — else a client
-- could self-approve). But the pipeline (running as service_role) knows the real
-- verdict. It records it here, keyed by the media object key + owner; a BEFORE
-- INSERT trigger on posts stamps that verdict onto the new row and consumes it.
--
-- Trust model: only service_role / the trigger touch pipeline_verdicts (RLS on,
-- no client policies). The trigger only applies a verdict when one exists for
-- (media_url, owner) — so seed/service inserts that set moderation_status
-- explicitly are untouched, and a client insert referencing media it never
-- processed simply stays 'pending' (its default). A client cannot forge a
-- verdict, so it cannot self-approve.
-- ============================================================================

create table if not exists public.pipeline_verdicts (
  media_key         text primary key,
  owner_id          uuid not null references public.profiles (id) on delete cascade,
  moderation_status text not null check (moderation_status in ('approved', 'flagged', 'pending', 'removed')),
  created_at        timestamptz not null default now()
);

alter table public.pipeline_verdicts enable row level security;
-- No policies → authenticated/anon have no access; only service_role and the
-- SECURITY DEFINER trigger below can read/write it.

-- BEFORE INSERT on posts: if the pipeline recorded a verdict for this exact media
-- key owned by the inserting user, apply it and consume it. Otherwise leave the
-- row's moderation_status as supplied (client default 'pending'; seed sets its own).
create or replace function public.apply_pipeline_verdict()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _status text;
begin
  select moderation_status into _status
    from public.pipeline_verdicts
    where media_key = new.media_url and owner_id = new.user_id;
  if _status is not null then
    new.moderation_status := _status;
    delete from public.pipeline_verdicts where media_key = new.media_url;
  end if;
  return new;
end;
$fn$;

drop trigger if exists apply_pipeline_verdict_before_insert on public.posts;
create trigger apply_pipeline_verdict_before_insert
  before insert on public.posts
  for each row execute function public.apply_pipeline_verdict();

-- Housekeeping: prune verdicts whose upload was abandoned (never posted).
create or replace function public.prune_pipeline_verdicts(_older_than_seconds integer default 86400)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare _n integer;
begin
  delete from public.pipeline_verdicts where created_at < now() - make_interval(secs => _older_than_seconds);
  get diagnostics _n = row_count;
  return _n;
end;
$fn$;

revoke all on function public.prune_pipeline_verdicts(integer) from public;
grant execute on function public.prune_pipeline_verdicts(integer) to service_role;

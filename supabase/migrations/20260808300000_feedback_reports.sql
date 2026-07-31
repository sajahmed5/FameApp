-- ============================================================================
-- 20260808300000_feedback_reports
--
-- In-app issue reporting ("something's wrong with the app"), distinct from the
-- existing public.reports table, which is CONTENT moderation (reporting a post or
-- a user). These are product bug reports / ideas, reviewed in the admin portal.
--
-- Each report gets a short sequential `ref` so it can be referred to in
-- conversation ("fix #121"). An optional screenshot of the screen the reporter
-- was looking at is stored in a private `feedback` bucket.
--
-- Admin access is via the service role (the portal is server-rendered), matching
-- the rest of the dashboard — so no admin RLS policies are needed here.
-- ============================================================================

create table if not exists public.feedback_reports (
  id              uuid primary key default gen_random_uuid(),
  -- Human-facing number shown in the UI and used to discuss the issue.
  ref             bigint generated always as identity,
  -- Keep the report if the account is later deleted; it's product feedback.
  user_id         uuid references public.profiles (id) on delete set null,
  kind            text not null default 'bug' check (kind in ('bug', 'idea', 'other')),
  message         text not null check (length(btrim(message)) between 1 and 4000),
  screenshot_path text,                       -- object key in the private `feedback` bucket
  route           text,                       -- screen the reporter was on
  platform        text,                       -- ios | android | web
  app_version     text,
  status          text not null default 'new'
                    check (status in ('new', 'triaged', 'in_progress', 'fixed', 'wont_fix')),
  admin_note      text,                       -- "to fix #121, do X"
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists feedback_reports_ref on public.feedback_reports (ref);
create index if not exists feedback_reports_status_time
  on public.feedback_reports (status, created_at desc);

alter table public.feedback_reports enable row level security;
revoke all on public.feedback_reports from anon, authenticated;

-- Report as yourself; read back only your own. Status/admin_note are never
-- client-writable (no update policy) — only the service role changes them.
create policy feedback_insert_own on public.feedback_reports
  for insert to authenticated with check (user_id = auth.uid());
create policy feedback_select_own on public.feedback_reports
  for select to authenticated using (user_id = auth.uid());
grant insert (user_id, kind, message, screenshot_path, route, platform, app_version)
  on public.feedback_reports to authenticated;
grant select on public.feedback_reports to authenticated;

-- Keep updated_at honest for the portal's triage view.
create or replace function public.tg_feedback_touch()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists feedback_touch on public.feedback_reports;
create trigger feedback_touch before update on public.feedback_reports
  for each row execute function public.tg_feedback_touch();

-- ---------------------------------------------------------------------------
-- Screenshot bucket. Private; a reporter may only write under their own uid/
-- prefix, and reads are service-role only (the portal signs URLs server-side).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists feedback_upload_own on storage.objects;
create policy feedback_upload_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback' and (storage.foldername(name))[1] = auth.uid()::text);

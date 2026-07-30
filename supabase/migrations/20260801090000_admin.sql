-- ============================================================================
-- 20260801090000_admin
-- Backend for the separate Next.js moderation dashboard (portal.joinphixr.com).
--
-- The dashboard connects with the SERVICE ROLE key (server-side only) and so
-- bypasses RLS. Everything here is therefore about (a) giving moderation its own
-- tables, (b) making the audit log genuinely append-only even against the service
-- role, and (c) making admin-only tables inaccessible to the app roles
-- (anon/authenticated) as defence-in-depth — RLS on + zero policies.
--
-- Admin accounts are separate from app users: an admin is an auth.users row that
-- has a matching public.admin_users row. An admin need NOT have a public.profiles
-- row (they are not a Phixr user). App auth and admin auth share auth.users but the
-- dashboard only admits ids present in admin_users.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- admin_users : who may use the dashboard, and at what level.
--   moderator  — report queue, content actions, user actions
--   admin      — everything moderators can do + manage CSAM cases
--   superadmin — + manage admin_users
-- Gate is enforced in the app (service role bypasses RLS); RLS here just denies
-- the app roles any sight of the table.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  role         text not null default 'moderator' check (role in ('moderator', 'admin', 'superadmin')),
  display_name text not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id)
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;

-- ---------------------------------------------------------------------------
-- admin_audit_log : APPEND-ONLY record of every moderation action, including
-- any access to swipe attribution (anonymity rule). system-generated rows
-- (auto-hide) have admin_id = null.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id             uuid primary key default gen_random_uuid(),
  admin_id       uuid references auth.users (id),          -- null = system/auto
  action         text not null,                            -- 'dismiss','remove_post','remove_comment','warn','suspend','ban','force_private','delete_user','csam_open','csam_confirm','csam_submit','view_swipes','auto_hide', ...
  target_type    text,                                     -- 'post','comment','user','report','swipes','csam'
  target_id      uuid,
  target_user_id uuid,                                     -- the user the action concerns, when applicable
  reason         text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists admin_audit_log_created_at on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_user on public.admin_audit_log (target_user_id);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;

-- Append-only: block UPDATE/DELETE for EVERYONE, including the service role
-- (which bypasses RLS but not triggers).
create or replace function public.admin_audit_log_immutable()
returns trigger language plpgsql as $fn$
begin
  raise exception 'admin_audit_log is append-only (% attempted)', tg_op;
end;
$fn$;
drop trigger if exists tg_admin_audit_log_immutable on public.admin_audit_log;
create trigger tg_admin_audit_log_immutable
  before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_immutable();

-- ---------------------------------------------------------------------------
-- Account status on profiles. Login itself is stopped via Supabase Auth ban
-- (auth.users.banned_until) done by the dashboard; this column mirrors the
-- moderation state for display/queries and gates content visibility below.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active', 'suspended', 'banned', 'frozen'));
alter table public.profiles add column if not exists status_reason     text;
alter table public.profiles add column if not exists status_updated_at  timestamptz;
alter table public.profiles add column if not exists status_updated_by  uuid references auth.users (id);
-- account_status is moderation-only: revoke it from the app's profile update grant.
revoke update (account_status, status_reason, status_updated_at, status_updated_by)
  on public.profiles from authenticated;

-- ---------------------------------------------------------------------------
-- csam_reports : the CSAM escalation path, deliberately separate. Confirmed
-- cases FREEZE (never delete) the account and PRESERVE the media as evidence.
-- The subject reference is intentionally NOT a cascading FK — evidence must
-- survive even if the profile is later removed by other means.
-- ---------------------------------------------------------------------------
create table if not exists public.csam_reports (
  id               uuid primary key default gen_random_uuid(),
  subject_user_id  uuid not null,                          -- no FK on purpose: evidence outlives the profile
  status           text not null default 'open'
                     check (status in ('open', 'confirmed', 'submitted', 'closed')),
  opened_by        uuid references auth.users (id),
  confirmed_by     uuid references auth.users (id),
  source_report_id uuid references public.reports (id),
  -- Preserved evidence snapshot: account details, post/comment ids, the storage
  -- object keys copied into the 'evidence' bucket, and hashes. Never mutated
  -- after confirmation except to record the NCMEC submission.
  evidence         jsonb not null default '{}'::jsonb,
  ncmec_report_id  text,                                   -- filled by the (stubbed) NCMEC submission
  notes            text,
  created_at       timestamptz not null default now(),
  confirmed_at     timestamptz,
  submitted_at     timestamptz
);
create index if not exists csam_reports_status on public.csam_reports (status, created_at desc);
alter table public.csam_reports enable row level security;
revoke all on public.csam_reports from anon, authenticated;

-- Private evidence bucket. Copies of confirmed-case media are preserved here so
-- the originals can be removed from the serving bucket without losing evidence.
-- Never public; only the service role reaches it (no storage policies added).
insert into storage.buckets (id, name, public, file_size_limit)
values ('evidence', 'evidence', false, 524288000)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Report-threshold auto-hide. When a piece of content collects reports from
-- REPORT_AUTOHIDE_THRESHOLD distinct users, hide it immediately (pending human
-- review) and record a system audit row. It then surfaces in the queue as
-- priority (the queue treats already-hidden targets as priority).
-- ---------------------------------------------------------------------------
create or replace function public.reports_autohide()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  _threshold constant integer := 3;
  _distinct  integer;
begin
  select count(distinct reporter_id) into _distinct
  from public.reports
  where target_type = new.target_type and target_id = new.target_id and status = 'open';

  if _distinct < _threshold then
    return new;
  end if;

  if new.target_type = 'post' then
    update public.posts set moderation_status = 'flagged', updated_at = now()
    where id = new.target_id and moderation_status in ('pending', 'approved');
  elsif new.target_type = 'comment' then
    update public.comments set deleted_at = now(), body = '[hidden pending review]'
    where id = new.target_id and deleted_at is null;
  else
    return new; -- 'user' reports don't auto-hide content
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (null, 'auto_hide', new.target_type, new.target_id,
          'auto-hidden: ' || _distinct || ' distinct reports',
          jsonb_build_object('distinct_reports', _distinct, 'threshold', _threshold));
  return new;
end;
$fn$;
drop trigger if exists tg_reports_autohide on public.reports;
create trigger tg_reports_autohide
  after insert on public.reports
  for each row execute function public.reports_autohide();

-- ---------------------------------------------------------------------------
-- Content visibility must respect account status: posts from suspended/banned/
-- frozen accounts leave the public discovery deck. Re-emit get_deck with the
-- extra predicate (body otherwise identical to 20260729090000_profile.sql).
-- ---------------------------------------------------------------------------
create or replace function public.get_deck(_limit integer default 20, _exclude uuid[] default '{}')
returns table (
  id uuid, user_id uuid, media_url text, thumbnail_url text, media_type text, caption text,
  alt_text text, like_count integer, skip_count integer, comment_count integer, created_at timestamptz,
  poster_handle text, poster_display_name text, poster_avatar_url text, tags text[]
) language sql stable security definer set search_path = '' as $fn$
  with base as (
    select p.id, p.user_id, p.media_url, p.thumbnail_url, p.media_type, p.caption,
           p.alt_text, p.like_count, p.skip_count, p.comment_count, p.created_at
    from public.posts p
    where p.visibility = 'public' and p.moderation_status = 'approved'
      and p.user_id <> auth.uid() and p.id <> all(_exclude)
      and exists (select 1 from public.profiles pr where pr.id = p.user_id and pr.account_status = 'active')
      and not exists (select 1 from public.swipes s where s.user_id = auth.uid() and s.post_id = p.id)
      and not exists (select 1 from public.blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id) or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
      and not exists (select 1 from public.mutes m where m.muter_id = auth.uid() and m.muted_id = p.user_id)
  ),
  ranked as (
    select b.*,
      coalesce((select sum(ut.weight) from public.post_tags pt
        join public.user_tags ut on ut.tag_id = pt.tag_id and ut.user_id = auth.uid()
        where pt.post_id = b.id), 0)::double precision as affinity,
      exp(-extract(epoch from (now() - b.created_at)) / (72.0 * 3600.0)) as freshness,
      ln(2 + coalesce(pr.points_balance, 0)) as points_boost
    from base b join public.profiles pr on pr.id = b.user_id
  ),
  ranked2 as (select r.*, (r.affinity * 3.0 + r.freshness * 2.0 + r.points_boost * 0.5) as score from ranked r),
  matched as (select * from ranked2 where affinity > 0 order by score desc limit ceil(_limit * 0.9)),
  explore as (select * from ranked2 where affinity = 0 and id not in (select id from matched)
    order by (freshness * 2.0 + points_boost * 0.5) desc, random() limit greatest(_limit - (select count(*) from matched), 0)),
  combined as (select * from matched union all select * from explore)
  select c.id, c.user_id, c.media_url, c.thumbnail_url, c.media_type, c.caption, c.alt_text,
    c.like_count, c.skip_count, c.comment_count, c.created_at, pr.handle, pr.display_name, pr.avatar_url,
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tags
  from combined c join public.profiles pr on pr.id = c.user_id
  left join public.post_tags pt on pt.post_id = c.id left join public.tags t on t.id = pt.tag_id
  group by c.id, c.user_id, c.media_url, c.thumbnail_url, c.media_type, c.caption, c.alt_text,
    c.like_count, c.skip_count, c.comment_count, c.created_at, c.score, pr.handle, pr.display_name, pr.avatar_url
  order by c.score desc limit _limit;
$fn$;

-- ============================================================================
-- 20260808370000_anon_feedback
--
-- Reporting required an account, so the screens where people get stuck hardest —
-- login, forgot-password, sign-up — had no way to tell us anything. That is the
-- highest-friction part of the funnel and the part we heard nothing from.
--
-- Deliberately NOT done by adding an `anon` insert policy: that would be an open,
-- unauthenticated write endpoint on a public table, i.e. a spam firehose. Instead
-- a SECURITY DEFINER function is the only anon path, and it:
--   * writes user_id NULL (nothing to attribute, and no profile to reference)
--   * accepts NO attachment — anon has no storage grant, so the surface stays small
--   * rate-limits per client IP, keeping only a SALTED HASH of the address
--
-- Signed-in reporting is untouched and still goes through the table policy.
-- ============================================================================

-- Throttle state. Only a hash is stored: enough to count, useless as a record of
-- who reported what.
create table if not exists public.anon_feedback_throttle (
  ip_hash      text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);
alter table public.anon_feedback_throttle enable row level security;
revoke all on public.anon_feedback_throttle from anon, authenticated;

comment on table public.anon_feedback_throttle is
  'Rate-limit counters for submit_anon_feedback. Stores a salted hash of the client IP, never the address.';

create or replace function public.submit_anon_feedback(
  _kind        text,
  _message     text,
  _route       text default null,
  _platform    text default null,
  _app_version text default null
)
returns bigint language plpgsql security definer set search_path = '' as $fn$
declare
  _ip      text;
  _hash    text;
  _limit   constant integer := 5;      -- per IP per hour
  _count   integer;
  _started timestamptz;
  _ref     bigint;
begin
  if _kind is null or _kind not in ('bug', 'idea', 'other') then
    _kind := 'bug';
  end if;
  _message := btrim(coalesce(_message, ''));
  if length(_message) < 1 or length(_message) > 4000 then
    raise exception 'Message must be between 1 and 4000 characters.' using errcode = '22023';
  end if;

  -- Behind PostgREST the real client address arrives in the forwarded header; the
  -- direct connection address is the pooler's. Fall back to a shared bucket so a
  -- missing header can't be used to bypass the limit entirely.
  _ip := coalesce(
    split_part(nullif(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1),
    'unknown');
  _hash := encode(extensions.digest('phixr-anon-feedback:' || _ip, 'sha256'), 'hex');

  select t.count, t.window_start into _count, _started
    from public.anon_feedback_throttle t where t.ip_hash = _hash for update;

  if _started is null or _started < now() - interval '1 hour' then
    insert into public.anon_feedback_throttle (ip_hash, window_start, count)
      values (_hash, now(), 1)
      on conflict (ip_hash) do update set window_start = now(), count = 1;
  elsif _count >= _limit then
    raise exception 'Too many reports from this device. Please try again later.'
      using errcode = 'P0001';
  else
    update public.anon_feedback_throttle
       set count = count + 1 where ip_hash = _hash;
  end if;

  insert into public.feedback_reports (user_id, kind, message, route, platform, app_version)
    values (null, _kind, _message, _route, _platform, _app_version)
    returning ref into _ref;

  return _ref;
end $fn$;

revoke all on function public.submit_anon_feedback(text, text, text, text, text) from public;
grant execute on function public.submit_anon_feedback(text, text, text, text, text) to anon;

-- Old rows are only ever counters; drop them once the window is long gone.
create index if not exists anon_feedback_throttle_window
  on public.anon_feedback_throttle (window_start);

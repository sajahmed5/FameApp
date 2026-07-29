-- ============================================================================
-- 20260808130000_points_economy
--
-- Points economy v2:
--  1. New earnable actions: share (+3), new-conversation message (+2), active-day (+5).
--  2. Anti-gaming: a per-day earn CEILING + per-reason daily caps / diminishing returns.
--  3. Dwell gate: rapid-fire swiping (< ~1s apart) records the swipe but earns nothing.
--  4. Batched creator reward: every 10 likes a post accrues, its owner earns +3 — logged
--     as an aggregate "like_milestone" on the POST (never the swipe/swiper), so it does
--     not join or reference swipes. NOTE: this relaxes the "a swipe never credits the
--     owner" invariant by the owner's explicit choice; timing at very low user counts
--     could still hint at a liker. It becomes genuinely private as the base grows.
--
-- Security wiring is preserved: award_points stays revoked from `authenticated`
-- (owner/action-function only); record_swipe stays SECURITY DEFINER; the three new
-- award_* entry points are SECURITY DEFINER and call award_points internally.
-- ============================================================================

-- --- 1. Awardable reasons + their base values --------------------------------
create or replace function public.points_for_reason(_reason text)
returns integer language sql immutable set search_path = '' as $fn$
  select case _reason
    when 'swipe'            then 1   -- left or right, deliberately equal
    when 'comment'          then 5
    when 'comment_reply'    then 5
    when 'comment_reaction' then 2
    when 'share'            then 3   -- NEW
    when 'message_new'      then 2   -- NEW: starting a conversation
    when 'active_day'       then 5   -- NEW: first real action of the day
    else null
  end;
$fn$;

-- --- 2. award_points + anti-gaming (fills the previously stubbed pipeline) ----
create or replace function public.award_points(
  _reason   text,
  _ref_type text default null,
  _ref_id   uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _user_id uuid := auth.uid();
  _base    integer;
  _delta   integer;
  _balance bigint;
  _today_reason integer;
  _today_total  bigint;
  _daily_cap constant integer := 1000;  -- generous (heavy daily use is fine), but bounded
begin
  if _user_id is null then
    raise exception 'award_points: not authenticated';
  end if;
  _base := public.points_for_reason(_reason);
  if _base is null then
    raise exception 'award_points: reason % is not awardable', _reason;
  end if;
  _delta := _base;

  -- Per-reason daily caps / diminishing returns.
  select count(*) into _today_reason
  from public.points_ledger
  where user_id = _user_id and reason = _reason and delta > 0
    and created_at >= date_trunc('day', now());

  if    _reason = 'swipe'       and _today_reason >= 200 then _delta := 0;  -- diminishing returns
  elsif _reason = 'share'       and _today_reason >= 5   then _delta := 0;
  elsif _reason = 'message_new' and _today_reason >= 5   then _delta := 0;
  elsif _reason = 'active_day'  and _today_reason >= 1   then _delta := 0;  -- once per day
  end if;

  -- Daily earn ceiling across all reasons.
  if _delta > 0 then
    select coalesce(sum(delta), 0) into _today_total
    from public.points_ledger
    where user_id = _user_id and delta > 0 and created_at >= date_trunc('day', now());
    _delta := least(_delta, greatest(_daily_cap - _today_total, 0));
  end if;

  if _delta <> 0 then
    perform public._award_to(_user_id, _delta, _reason, _ref_type, _ref_id);
  end if;

  select points_balance into _balance from public.profiles where id = _user_id;
  return _balance;
end;
$fn$;

-- --- 3+4. record_swipe: dwell gate + batched creator reward ------------------
alter table public.posts add column if not exists likes_rewarded_upto integer not null default 0;

create or replace function public.record_swipe(_post_id uuid, _direction text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _inserted integer;
  _balance  bigint;
  _last     timestamptz;
  _dwell_ok boolean;
  _lc       integer;
  _upto     integer;
  _owner    uuid;
  _buckets  integer;
begin
  if _direction not in ('left', 'right') then
    raise exception 'record_swipe: direction must be left or right';
  end if;

  -- Dwell gate: how long since this user's previous swipe? (captured BEFORE inserting)
  select max(created_at) into _last from public.swipes where user_id = auth.uid();
  _dwell_ok := (_last is null or now() - _last >= interval '1 second');

  insert into public.swipes (user_id, post_id, direction)
  values (auth.uid(), _post_id, _direction)
  on conflict (user_id, post_id) do nothing;
  get diagnostics _inserted = row_count;

  if _inserted > 0 then
    -- Points are best-effort: a subtransaction so ANY points error is swallowed and
    -- can NEVER roll back the swipe itself (the swipe is the core flow).
    begin
      -- Swiper earns only if they actually looked (no rapid-fire / bot farming).
      if _dwell_ok then
        _balance := public.award_points('swipe', 'swipe', _post_id);
      else
        select points_balance into _balance from public.profiles where id = auth.uid();
      end if;

      -- Batched creator reward on likes. like_count was just bumped by the AFTER-INSERT
      -- trigger. Award +3 per completed group of 10, referencing the POST only.
      if _direction = 'right' then
        select p.like_count, p.likes_rewarded_upto, p.user_id
          into _lc, _upto, _owner
        from public.posts p where p.id = _post_id;
        _buckets := (_lc / 10) - (_upto / 10);
        if _buckets > 0 and _owner is not null and _owner <> auth.uid() then
          perform public._award_to(_owner, _buckets * 3, 'like_milestone', 'post', _post_id);
          update public.posts set likes_rewarded_upto = _lc where id = _post_id;
        end if;
      end if;
    exception when others then
      select points_balance into _balance from public.profiles where id = auth.uid();
    end;
  else
    select points_balance into _balance from public.profiles where id = auth.uid();
  end if;

  return _balance;
end;
$fn$;
revoke all on function public.record_swipe(uuid, text) from public;
grant execute on function public.record_swipe(uuid, text) to authenticated;

-- --- 5. New client-facing award entry points (SECURITY DEFINER; call award_points) ---
create or replace function public.award_share(_post_id uuid)
returns bigint language plpgsql security definer set search_path = '' as $fn$
begin
  return public.award_points('share', 'post', _post_id);
end;
$fn$;
revoke all on function public.award_share(uuid) from public;
grant execute on function public.award_share(uuid) to authenticated;

create or replace function public.award_message_activity(_conversation_id uuid)
returns bigint language plpgsql security definer set search_path = '' as $fn$
begin
  return public.award_points('message_new', 'conversation', _conversation_id);
end;
$fn$;
revoke all on function public.award_message_activity(uuid) from public;
grant execute on function public.award_message_activity(uuid) to authenticated;

create or replace function public.award_active_day()
returns bigint language plpgsql security definer set search_path = '' as $fn$
begin
  return public.award_points('active_day', null, null);
end;
$fn$;
revoke all on function public.award_active_day() from public;
grant execute on function public.award_active_day() to authenticated;

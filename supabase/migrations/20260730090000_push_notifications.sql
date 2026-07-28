-- ============================================================================
-- 20260730090000_push_notifications
-- Push notifications: device tokens, a notifications inbox, throttled enqueue,
-- source triggers, delayed aggregate reach milestones, and dispatch from a
-- Postgres trigger into the `send-push` Edge Function (via pg_net).
--
-- ANONYMITY (§9/§13) — CRITICAL:
--   * There is NO trigger on `swipes`. Likes/skips NEVER produce a notification;
--     a real-time "someone liked your post" would reveal who was swiping.
--   * Reach milestones are AGGREGATE (based on total reach_count) and DELAYED
--     (a pg_cron job, not the swipe path), so they are never tied to an
--     individual swipe.
-- ============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- 0. Private config the dispatch trigger reads (edge base url + keys). Not in
--    the API schema, no client access.
-- ---------------------------------------------------------------------------
create schema if not exists private;
create table if not exists private.config (key text primary key, value text not null);

-- ---------------------------------------------------------------------------
-- 1. Device push tokens (Expo). One row per device token; a user may have
--    several (phone + tablet). The client upserts its own.
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
create policy push_tokens_own on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Notifications inbox. Written only by triggers (SECURITY DEFINER); the
--    recipient reads their own. `count` supports coalesced/throttled entries.
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,  -- recipient
  type       text not null check (type in (
                'new_follower','follow_request','follow_accepted',
                'comment','reply','comment_reaction','reach_milestone','moderation')),
  actor_id   uuid references public.profiles (id) on delete cascade,           -- who caused it (nullable)
  post_id    uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  count      integer not null default 1,                                        -- coalesced events
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_time on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update, delete on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;  -- mark-as-read only

-- ---------------------------------------------------------------------------
-- 3. enqueue_notification — the single choke point. Enforces "don't notify
--    self", respects blocks, and THROTTLES: a matching UNREAD notification for
--    the same (recipient, type, target) within a short window is COALESCED
--    (count++, bumped) instead of inserting a new row — so a hot thread fires
--    one push, not twenty. A new row is what triggers a push (step 6); a
--    coalesce is an UPDATE and sends nothing.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_notification(
  _recipient uuid, _type text, _actor uuid, _post_id uuid, _comment_id uuid, _payload jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = '' as $fn$
declare
  _window constant interval := interval '10 minutes';
  _existing uuid;
begin
  if _recipient is null or _recipient = coalesce(_actor, '00000000-0000-0000-0000-000000000000') then
    return;  -- never notify yourself
  end if;
  -- respect blocks in either direction
  if _actor is not null and exists (
    select 1 from public.blocks b
    where (b.blocker_id = _recipient and b.blocked_id = _actor)
       or (b.blocker_id = _actor and b.blocked_id = _recipient)
  ) then
    return;
  end if;

  -- coalesce an existing unread notification of the same type + target
  select id into _existing from public.notifications n
   where n.user_id = _recipient and n.type = _type and n.read_at is null
     and n.created_at > now() - _window
     and n.post_id is not distinct from _post_id
     and n.comment_id is not distinct from _comment_id
   limit 1;

  if _existing is not null then
    update public.notifications
       set count = count + 1, actor_id = _actor, created_at = now(), payload = _payload
     where id = _existing;
  else
    insert into public.notifications (user_id, type, actor_id, post_id, comment_id, payload)
      values (_recipient, _type, _actor, _post_id, _comment_id, _payload);
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Source triggers → enqueue. NONE on swipes (anonymity).
-- ---------------------------------------------------------------------------

-- follows: new follower / follow request (insert), follow accepted (update)
create or replace function public.tg_notify_follow()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'INSERT' then
    if new.status = 'accepted' then
      perform public.enqueue_notification(new.followee_id, 'new_follower', new.follower_id, null, null, '{}');
    else
      perform public.enqueue_notification(new.followee_id, 'follow_request', new.follower_id, null, null, '{}');
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    -- the followee accepted → tell the follower
    perform public.enqueue_notification(new.follower_id, 'follow_accepted', new.followee_id, null, null, '{}');
  end if;
  return null;
end;
$fn$;
drop trigger if exists notify_follow on public.follows;
create trigger notify_follow after insert or update on public.follows
  for each row execute function public.tg_notify_follow();

-- comments: comment on your post / reply to your comment
create or replace function public.tg_notify_comment()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare _post_owner uuid; _parent_author uuid;
begin
  if new.parent_comment_id is null then
    select user_id into _post_owner from public.posts where id = new.post_id;
    -- coalesce by POST (comment_id null) so N comments on one post = one notification
    perform public.enqueue_notification(_post_owner, 'comment', new.user_id, new.post_id, null, '{}');
  else
    select user_id into _parent_author from public.comments where id = new.parent_comment_id;
    perform public.enqueue_notification(_parent_author, 'reply', new.user_id, new.post_id, new.parent_comment_id, '{}');
  end if;
  return null;
end;
$fn$;
drop trigger if exists notify_comment on public.comments;
create trigger notify_comment after insert on public.comments
  for each row execute function public.tg_notify_comment();

-- comment_reactions: reaction on your comment
create or replace function public.tg_notify_reaction()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare _comment_author uuid; _post uuid;
begin
  select user_id, post_id into _comment_author, _post from public.comments where id = new.comment_id;
  perform public.enqueue_notification(_comment_author, 'comment_reaction', new.user_id, _post, new.comment_id,
    jsonb_build_object('emoji', new.emoji));
  return null;
end;
$fn$;
drop trigger if exists notify_reaction on public.comment_reactions;
create trigger notify_reaction after insert on public.comment_reactions
  for each row execute function public.tg_notify_reaction();

-- moderation outcome on your content
create or replace function public.tg_notify_moderation()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.moderation_status is distinct from old.moderation_status
     and new.moderation_status in ('approved','flagged','removed') then
    perform public.enqueue_notification(new.user_id, 'moderation', null, new.id, null,
      jsonb_build_object('status', new.moderation_status));
  end if;
  return null;
end;
$fn$;
drop trigger if exists notify_moderation on public.posts;
create trigger notify_moderation after update of moderation_status on public.posts
  for each row execute function public.tg_notify_moderation();

-- ---------------------------------------------------------------------------
-- 5. Reach milestones — AGGREGATE + DELAYED. A pg_cron job scans posts whose
--    reach_count has crossed a new milestone since last notified. Never runs on
--    the swipe path, so it can't be tied to an individual swipe.
-- ---------------------------------------------------------------------------
alter table public.posts add column if not exists last_milestone integer not null default 0;

create or replace function public.check_reach_milestones()
returns integer language plpgsql security definer set search_path = '' as $fn$
declare _n integer := 0; r record; _new_ms integer;
  _milestones constant integer[] := array[100, 500, 1000, 5000, 10000, 50000, 100000];
begin
  for r in
    select id, user_id, reach_count, last_milestone from public.posts
     where moderation_status = 'approved' and reach_count > last_milestone
  loop
    -- the largest milestone at/under current reach that's above what we last notified
    select max(m) into _new_ms from unnest(_milestones) m where m <= r.reach_count and m > r.last_milestone;
    if _new_ms is not null then
      perform public.enqueue_notification(r.user_id, 'reach_milestone', null, r.id, null,
        jsonb_build_object('milestone', _new_ms, 'reach', r.reach_count));
      update public.posts set last_milestone = _new_ms where id = r.id;
      _n := _n + 1;
    end if;
  end loop;
  return _n;
end;
$fn$;

-- Schedule it every 15 minutes (delayed + aggregate). Safe to re-run.
select cron.schedule('reach-milestones', '*/15 * * * *', $$select public.check_reach_milestones();$$)
  where not exists (select 1 from cron.job where jobname = 'reach-milestones');

-- ---------------------------------------------------------------------------
-- 6. Dispatch: on a NEW notification row, POST its id to the send-push Edge
--    Function via pg_net (async, non-blocking). Coalesce UPDATEs don't fire
--    this, so throttling holds. Config/keys come from private.config.
-- ---------------------------------------------------------------------------
create or replace function public.tg_notification_dispatch()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare _base text; _anon text; _secret text;
begin
  select value into _base   from private.config where key = 'edge_base_url';
  select value into _anon   from private.config where key = 'anon_key';
  select value into _secret from private.config where key = 'push_webhook_secret';
  if _base is null then return new; end if;  -- not configured yet → no-op
  perform net.http_post(
    url     := _base || '/functions/v1/send-push',
    body    := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', coalesce(_anon, ''),
      'Authorization', 'Bearer ' || coalesce(_anon, ''),
      'x-webhook-secret', coalesce(_secret, '')
    )
  );
  return new;
end;
$fn$;
drop trigger if exists notification_dispatch on public.notifications;
create trigger notification_dispatch after insert on public.notifications
  for each row execute function public.tg_notification_dispatch();

-- ---------------------------------------------------------------------------
-- 7. Client-facing RPCs: enriched inbox, unread count, mark read.
-- ---------------------------------------------------------------------------
create or replace function public.get_notifications(_limit integer default 40, _before timestamptz default null)
returns table (
  id uuid, type text, count integer, payload jsonb, read_at timestamptz, created_at timestamptz,
  actor_handle text, actor_display_name text, actor_avatar_url text,
  post_id uuid, post_thumbnail text, comment_id uuid
) language sql stable security definer set search_path = '' as $fn$
  select n.id, n.type, n.count, n.payload, n.read_at, n.created_at,
    pr.handle, pr.display_name, pr.avatar_url,
    n.post_id, po.thumbnail_url, n.comment_id
  from public.notifications n
  left join public.profiles pr on pr.id = n.actor_id
  left join public.posts po on po.id = n.post_id
  where n.user_id = auth.uid()
    and (_before is null or n.created_at < _before)
  order by n.created_at desc
  limit greatest(_limit, 0);
$fn$;
revoke all on function public.get_notifications(integer, timestamptz) from public;
grant execute on function public.get_notifications(integer, timestamptz) to authenticated;

create or replace function public.unread_notification_count()
returns integer language sql stable security definer set search_path = '' as $fn$
  select count(*)::integer from public.notifications where user_id = auth.uid() and read_at is null;
$fn$;
revoke all on function public.unread_notification_count() from public;
grant execute on function public.unread_notification_count() to authenticated;

create or replace function public.mark_notifications_read(_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = '' as $fn$
declare _n integer;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null
     and (_ids is null or id = any(_ids));
  get diagnostics _n = row_count;
  return _n;
end;
$fn$;
revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Notification preference categories (replace the earlier placeholder set).
--    'moderation' is intentionally NOT toggleable — policy/safety always sends.
-- ---------------------------------------------------------------------------
alter table public.notification_prefs alter column prefs set default
  '{"follows":true,"requests":true,"comments":true,"reactions":true,"reach":true}'::jsonb;

-- ============================================================================
-- 20260803090000_messages
-- Direct + group messaging. SAFETY IS SERVER-SIDE (not the client):
--   • Minors (age_band='minor') can only be in conversations with other minors —
--     no minor↔adult DMs or group invites, enforced by a trigger on membership
--     AND by can_dm() in the start/send RPCs.
--   • Blocks cut messaging both ways; a blocked user can't start a conversation.
-- A user can read ONLY conversations they belong to (RLS). All mutations go
-- through SECURITY DEFINER RPCs; direct writes are revoked.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('direct', 'group')),
  name       text,                                  -- groups only
  avatar_url text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()      -- bumped on each new message (for sorting)
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            text not null default 'member' check (role in ('member', 'admin')),
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  muted           boolean not null default false,
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user on public.conversation_members (user_id);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text,
  media_url       text,                              -- object key in the 'media' bucket (scanned)
  shared_post_id  uuid references public.posts (id) on delete set null,
  reply_to_id     uuid references public.messages (id) on delete set null,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,                        -- tombstone (kept so the thread survives)
  constraint messages_not_empty check (
    deleted_at is not null or body is not null or media_url is not null or shared_post_id is not null)
);
create index if not exists messages_conversation_time on public.messages (conversation_id, created_at desc);

create table if not exists public.message_requests (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  recipient_id    uuid not null references public.profiles (id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at      timestamptz not null default now(),
  primary key (conversation_id, recipient_id)
);

-- reports may now target a message or a whole conversation
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('post', 'user', 'comment', 'message', 'conversation'));

-- 'message' is a notification type
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('new_follower','follow_request','follow_accepted',
                  'comment','reply','comment_reaction','reach_milestone','moderation','message'));

-- default message notifications on
alter table public.notification_prefs alter column prefs set default
  '{"follows":true,"requests":true,"comments":true,"reactions":true,"reach":true,"messages":true}'::jsonb;

-- ---------------------------------------------------------------------------
-- Membership helper (used by RLS + RPCs).
-- ---------------------------------------------------------------------------
create or replace function public.is_conversation_member(_cid uuid, _uid uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.conversation_members m where m.conversation_id = _cid and m.user_id = _uid);
$fn$;

-- Can these two users exchange DMs? Same age band (no minor↔adult) AND not
-- blocked either way. The safety spine of messaging.
create or replace function public.can_dm(_a uuid, _b uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select _a = _b or (
    (select age_band from public.profiles where id = _a)
      is not distinct from (select age_band from public.profiles where id = _b)
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = _a and b.blocked_id = _b) or (b.blocker_id = _b and b.blocked_id = _a))
  );
$fn$;

-- ---------------------------------------------------------------------------
-- RLS: read only what you're a member of.
-- ---------------------------------------------------------------------------
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.message_requests     enable row level security;

create policy conversations_select on public.conversations for select to authenticated
  using (public.is_conversation_member(id, auth.uid()));

create policy members_select on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id, auth.uid()));

create policy messages_select on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id, auth.uid()));

create policy requests_select on public.message_requests for select to authenticated
  using (recipient_id = auth.uid() or public.is_conversation_member(conversation_id, auth.uid()));

-- No direct writes: everything goes through the SECURITY DEFINER RPCs below.
revoke insert, update, delete on public.conversations, public.conversation_members,
  public.messages, public.message_requests from anon, authenticated;

-- ---------------------------------------------------------------------------
-- MINOR SAFETY: a conversation may never mix a minor with an adult. Fires on
-- every membership insert (direct or group, however added) — server-side.
-- ---------------------------------------------------------------------------
create or replace function public.tg_members_age_gate()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare _band text := (select age_band from public.profiles where id = new.user_id);
begin
  if exists (
    select 1 from public.conversation_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.conversation_id = new.conversation_id
      and cm.user_id <> new.user_id
      and p.age_band is distinct from _band
  ) then
    raise exception 'age_gate: minors can only message users in the same age band';
  end if;
  return new;
end $fn$;
drop trigger if exists tg_members_age_gate on public.conversation_members;
create trigger tg_members_age_gate before insert on public.conversation_members
  for each row execute function public.tg_members_age_gate();

-- ---------------------------------------------------------------------------
-- Start (or find) a direct conversation. If the recipient does NOT already
-- accept-follow the sender, it becomes a message request. Blocks + age band are
-- enforced by can_dm (and the membership trigger as a backstop).
-- ---------------------------------------------------------------------------
create or replace function public.start_direct(_other uuid)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare _me uuid := auth.uid(); _cid uuid;
begin
  if _me is null or _other is null or _me = _other then raise exception 'bad_request'; end if;
  if not public.can_dm(_me, _other) then raise exception 'not_allowed'; end if;

  -- existing 1:1 direct conversation between exactly these two?
  select c.id into _cid
  from public.conversations c
  where c.type = 'direct'
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = _me)
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = _other)
    and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = 2
  limit 1;
  if _cid is not null then return _cid; end if;

  insert into public.conversations (type, created_by) values ('direct', _me) returning id into _cid;
  insert into public.conversation_members (conversation_id, user_id, role) values (_cid, _me, 'member');
  insert into public.conversation_members (conversation_id, user_id, role) values (_cid, _other, 'member');

  -- If the recipient doesn't accept-follow the sender, gate it behind a request.
  if not exists (select 1 from public.follows f
                 where f.follower_id = _other and f.followee_id = _me and f.status = 'accepted') then
    insert into public.message_requests (conversation_id, recipient_id, status) values (_cid, _other, 'pending');
  end if;
  return _cid;
end $fn$;

-- Create a group. Creator is admin. Everyone (creator + members) must be age
-- compatible — the membership trigger enforces it; we also pre-check for a clean error.
create or replace function public.create_group(_name text, _members uuid[])
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare _me uuid := auth.uid(); _cid uuid; _uid uuid;
begin
  if _me is null then raise exception 'unauthorized'; end if;
  insert into public.conversations (type, name, created_by) values ('group', nullif(btrim(_name), ''), _me) returning id into _cid;
  insert into public.conversation_members (conversation_id, user_id, role) values (_cid, _me, 'admin');
  foreach _uid in array coalesce(_members, '{}') loop
    if _uid <> _me then
      if not public.can_dm(_me, _uid) then raise exception 'not_allowed'; end if;
      insert into public.conversation_members (conversation_id, user_id, role)
        values (_cid, _uid, 'member') on conflict do nothing;
    end if;
  end loop;
  return _cid;
end $fn$;

-- Send a message. Enforces membership, age band + blocks, and the request rule:
-- until a request is accepted the requester may send only the FIRST message.
create or replace function public.send_message(
  _cid uuid, _body text default null, _media_url text default null,
  _shared_post_id uuid default null, _reply_to_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare
  _me uuid := auth.uid(); _mid uuid; _is_group boolean;
  _pending record; _other uuid; _msg_count int;
begin
  if _me is null then raise exception 'unauthorized'; end if;
  if not public.is_conversation_member(_cid, _me) then raise exception 'not_a_member'; end if;
  if coalesce(btrim(_body), '') = '' and _media_url is null and _shared_post_id is null then
    raise exception 'empty_message';
  end if;

  select (type = 'group') into _is_group from public.conversations where id = _cid;

  -- Re-check safety against every co-member (covers group + block-after-start).
  if exists (
    select 1 from public.conversation_members m where m.conversation_id = _cid and m.user_id <> _me
      and not public.can_dm(_me, m.user_id)
  ) then raise exception 'not_allowed'; end if;

  -- Request gate (direct only): if a pending request exists and I'm the sender
  -- (i.e. I'm NOT the recipient), I may only send the first message.
  if not _is_group then
    select * into _pending from public.message_requests
      where conversation_id = _cid and status = 'pending' limit 1;
    if _pending.recipient_id is not null and _pending.recipient_id <> _me then
      select count(*) into _msg_count from public.messages where conversation_id = _cid and sender_id = _me;
      if _msg_count >= 1 then raise exception 'request_pending'; end if;
    end if;
  end if;

  insert into public.messages (conversation_id, sender_id, body, media_url, shared_post_id, reply_to_id)
    values (_cid, _me, nullif(btrim(_body), ''), _media_url, _shared_post_id, _reply_to_id)
    returning id into _mid;

  update public.conversations set updated_at = now() where id = _cid;
  update public.conversation_members set last_read_at = now() where conversation_id = _cid and user_id = _me;

  -- Notify other members who haven't muted (enqueue_notification handles blocks +
  -- self + throttling). Deep-link payload carries the conversation id.
  perform public.enqueue_notification(m.user_id, 'message', _me, null, null,
            jsonb_build_object('conversation_id', _cid))
  from public.conversation_members m
  where m.conversation_id = _cid and m.user_id <> _me and m.muted = false
    -- don't notify the recipient of a still-pending request until they engage? No —
    -- the first message IS the request; they should be notified.
    ;
  return _mid;
end $fn$;

create or replace function public.respond_to_request(_cid uuid, _accept boolean)
returns void language plpgsql security definer set search_path = '' as $fn$
declare _me uuid := auth.uid();
begin
  update public.message_requests set status = case when _accept then 'accepted' else 'rejected' end
    where conversation_id = _cid and recipient_id = _me and status = 'pending';
  if not found then raise exception 'no_request'; end if;
  if not _accept then
    -- Decline: drop the conversation entirely for both parties.
    delete from public.conversations where id = _cid;
  end if;
end $fn$;

create or replace function public.mark_conversation_read(_cid uuid)
returns void language sql security definer set search_path = '' as $fn$
  update public.conversation_members set last_read_at = now()
    where conversation_id = _cid and user_id = auth.uid();
$fn$;

create or replace function public.set_conversation_muted(_cid uuid, _muted boolean)
returns void language sql security definer set search_path = '' as $fn$
  update public.conversation_members set muted = _muted
    where conversation_id = _cid and user_id = auth.uid();
$fn$;

create or replace function public.leave_conversation(_cid uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
declare _me uuid := auth.uid();
begin
  delete from public.conversation_members where conversation_id = _cid and user_id = _me;
  -- last member out → remove the conversation
  if not exists (select 1 from public.conversation_members where conversation_id = _cid) then
    delete from public.conversations where id = _cid;
  end if;
end $fn$;

-- Group admin adds/removes members.
create or replace function public.add_group_member(_cid uuid, _uid uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
declare _me uuid := auth.uid();
begin
  if not exists (select 1 from public.conversation_members where conversation_id = _cid and user_id = _me and role = 'admin')
    then raise exception 'not_admin'; end if;
  if not public.can_dm(_me, _uid) then raise exception 'not_allowed'; end if;
  insert into public.conversation_members (conversation_id, user_id, role) values (_cid, _uid, 'member')
    on conflict do nothing;
end $fn$;

create or replace function public.remove_group_member(_cid uuid, _uid uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
declare _me uuid := auth.uid();
begin
  if not exists (select 1 from public.conversation_members where conversation_id = _cid and user_id = _me and role = 'admin')
    then raise exception 'not_admin'; end if;
  delete from public.conversation_members where conversation_id = _cid and user_id = _uid and role <> 'admin';
end $fn$;

create or replace function public.delete_message(_mid uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
declare _me uuid := auth.uid();
begin
  update public.messages set deleted_at = now(), body = null, media_url = null, shared_post_id = null
    where id = _mid and sender_id = _me and deleted_at is null;
  if not found then raise exception 'not_your_message'; end if;
end $fn$;

create or replace function public.report_message(_mid uuid, _reason text, _detail text default null)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  insert into public.reports (reporter_id, target_type, target_id, reason, detail)
    values (auth.uid(), 'message', _mid, _reason, _detail);
end $fn$;

create or replace function public.report_conversation(_cid uuid, _reason text, _detail text default null)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if not public.is_conversation_member(_cid, auth.uid()) then raise exception 'not_a_member'; end if;
  insert into public.reports (reporter_id, target_type, target_id, reason, detail)
    values (auth.uid(), 'conversation', _cid, _reason, _detail);
end $fn$;

-- ---------------------------------------------------------------------------
-- Read RPCs.
-- ---------------------------------------------------------------------------
-- Conversation list: newest first, with the other party (direct) or group meta,
-- last message preview, unread flag, request flag, mute.
create or replace function public.get_conversations()
returns table (
  id uuid, type text, name text, avatar_url text,
  other_id uuid, other_handle text, other_display_name text, other_avatar_url text,
  member_count int, last_body text, last_media boolean, last_shared boolean,
  last_sender_id uuid, last_at timestamptz, unread boolean, muted boolean, is_request boolean
) language sql stable security definer set search_path = '' as $fn$
  with mine as (
    select m.conversation_id, m.last_read_at, m.muted
    from public.conversation_members m where m.user_id = auth.uid()
  ),
  last_msg as (
    select distinct on (msg.conversation_id) msg.conversation_id, msg.body, msg.media_url,
           msg.shared_post_id, msg.sender_id, msg.created_at, msg.deleted_at
    from public.messages msg
    join mine on mine.conversation_id = msg.conversation_id
    order by msg.conversation_id, msg.created_at desc
  )
  select c.id, c.type, c.name, c.avatar_url,
    o.id, o.handle, o.display_name, o.avatar_url,
    (select count(*)::int from public.conversation_members m where m.conversation_id = c.id),
    case when lm.deleted_at is not null then '[deleted]' else lm.body end,
    (lm.media_url is not null), (lm.shared_post_id is not null),
    lm.sender_id, coalesce(lm.created_at, c.created_at),
    (lm.created_at is not null and lm.created_at > mine.last_read_at and lm.sender_id <> auth.uid()),
    mine.muted,
    exists (select 1 from public.message_requests r
            where r.conversation_id = c.id and r.recipient_id = auth.uid() and r.status = 'pending')
  from public.conversations c
  join mine on mine.conversation_id = c.id
  left join last_msg lm on lm.conversation_id = c.id
  -- the "other" profile for a direct conversation
  left join lateral (
    select p.id, p.handle, p.display_name, p.avatar_url
    from public.conversation_members m2 join public.profiles p on p.id = m2.user_id
    where m2.conversation_id = c.id and m2.user_id <> auth.uid() and c.type = 'direct'
    limit 1
  ) o on true
  order by coalesce(lm.created_at, c.created_at) desc;
$fn$;

-- Conversation detail: meta, my membership, request status, members with read
-- positions (read receipts). Read positions are hidden from the requester while
-- a request is still pending.
create or replace function public.get_conversation(_cid uuid)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select case when not public.is_conversation_member(_cid, auth.uid()) then null else
    jsonb_build_object(
      'id', c.id, 'type', c.type, 'name', c.name, 'avatar_url', c.avatar_url, 'created_by', c.created_by,
      'my_role', (select role from public.conversation_members where conversation_id = c.id and user_id = auth.uid()),
      'request_status', (select status from public.message_requests where conversation_id = c.id and recipient_id = auth.uid()),
      'pending_incoming', exists (select 1 from public.message_requests where conversation_id = c.id and recipient_id = auth.uid() and status = 'pending'),
      'pending_outgoing', exists (select 1 from public.message_requests where conversation_id = c.id and recipient_id <> auth.uid() and status = 'pending'),
      'members', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
          'role', m.role,
          -- hide others' read position from the requester until the request is accepted
          'last_read_at', case when exists (
              select 1 from public.message_requests r where r.conversation_id = c.id and r.recipient_id <> auth.uid() and r.status = 'pending')
            and m.user_id <> auth.uid() then null else m.last_read_at end
        ) order by m.role desc, p.handle), '[]')
        from public.conversation_members m join public.profiles p on p.id = m.user_id
        where m.conversation_id = c.id))
  end
  from public.conversations c where c.id = _cid;
$fn$;

-- Paginated history (older-first pagination via _before).
create or replace function public.get_messages(_cid uuid, _limit int default 30, _before timestamptz default null)
returns table (
  id uuid, sender_id uuid, sender_handle text, sender_display_name text, sender_avatar_url text,
  body text, media_url text, shared_post_id uuid, shared_thumb text, shared_caption text, shared_handle text,
  reply_to_id uuid, reply_body text, reply_sender text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz
) language sql stable security definer set search_path = '' as $fn$
  select msg.id, msg.sender_id, sp.handle, sp.display_name, sp.avatar_url,
    case when msg.deleted_at is not null then null else msg.body end,
    case when msg.deleted_at is not null then null else msg.media_url end,
    case when msg.deleted_at is not null then null else msg.shared_post_id end,
    shp.thumbnail_url, shp.caption, shpo.handle,
    msg.reply_to_id,
    case when rm.deleted_at is not null then null else rm.body end, rp.handle,
    msg.created_at, msg.edited_at, msg.deleted_at
  from public.messages msg
  join public.profiles sp on sp.id = msg.sender_id
  left join public.posts shp on shp.id = msg.shared_post_id
  left join public.profiles shpo on shpo.id = shp.user_id
  left join public.messages rm on rm.id = msg.reply_to_id
  left join public.profiles rp on rp.id = rm.sender_id
  where msg.conversation_id = _cid
    and public.is_conversation_member(_cid, auth.uid())
    and (_before is null or msg.created_at < _before)
  order by msg.created_at desc
  limit greatest(_limit, 0);
$fn$;

-- ---------------------------------------------------------------------------
-- Realtime: members receive new messages + read-position changes. RLS above
-- applies to realtime, so only members get the rows.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversation_members;

-- ---------------------------------------------------------------------------
-- Message media storage RLS: a conversation member may read a media object that
-- is attached to a message in that conversation. Message images go through the
-- same upload pipeline (scan/transcode) as posts and land in the 'media' bucket.
-- ---------------------------------------------------------------------------
drop policy if exists media_read_message on storage.objects;
create policy media_read_message on storage.objects for select to authenticated
  using (
    bucket_id = 'media' and exists (
      select 1 from public.messages msg
      where msg.media_url = storage.objects.name
        and public.is_conversation_member(msg.conversation_id, auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
grant execute on function public.start_direct(uuid)                          to authenticated;
grant execute on function public.create_group(text, uuid[])                  to authenticated;
grant execute on function public.send_message(uuid, text, text, uuid, uuid)  to authenticated;
grant execute on function public.respond_to_request(uuid, boolean)           to authenticated;
grant execute on function public.mark_conversation_read(uuid)                to authenticated;
grant execute on function public.set_conversation_muted(uuid, boolean)       to authenticated;
grant execute on function public.leave_conversation(uuid)                    to authenticated;
grant execute on function public.add_group_member(uuid, uuid)                to authenticated;
grant execute on function public.remove_group_member(uuid, uuid)             to authenticated;
grant execute on function public.delete_message(uuid)                        to authenticated;
grant execute on function public.report_message(uuid, text, text)            to authenticated;
grant execute on function public.report_conversation(uuid, text, text)       to authenticated;
grant execute on function public.get_conversations()                         to authenticated;
grant execute on function public.get_conversation(uuid)                      to authenticated;
grant execute on function public.get_messages(uuid, int, timestamptz)        to authenticated;
grant execute on function public.can_dm(uuid, uuid)                          to authenticated;

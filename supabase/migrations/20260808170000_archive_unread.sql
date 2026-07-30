-- ============================================================================
-- 20260808170000_archive_unread
--
-- Per-user conversation archive + "mark as unread". Both are owner-scoped columns
-- on conversation_members, toggled via SECURITY DEFINER RPCs (like markRead/setMuted).
-- get_conversations now also returns `archived` so the client can split the inbox
-- into the normal list vs. an Archived view.
-- ============================================================================

alter table public.conversation_members
  add column if not exists archived boolean not null default false;

-- Archive / unarchive a conversation for the caller.
create or replace function public.set_conversation_archived(_cid uuid, _archived boolean)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  update public.conversation_members
  set archived = _archived
  where conversation_id = _cid and user_id = auth.uid();
end $fn$;
revoke all on function public.set_conversation_archived(uuid, boolean) from public;
grant execute on function public.set_conversation_archived(uuid, boolean) to authenticated;

-- Mark a conversation unread: rewind my last_read_at to just before the last message.
create or replace function public.mark_conversation_unread(_cid uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  update public.conversation_members m
  set last_read_at = coalesce(
    (select max(msg.created_at) from public.messages msg where msg.conversation_id = _cid) - interval '1 second',
    m.last_read_at
  )
  where m.conversation_id = _cid and m.user_id = auth.uid();
end $fn$;
revoke all on function public.mark_conversation_unread(uuid) from public;
grant execute on function public.mark_conversation_unread(uuid) to authenticated;

-- get_conversations, now returning `archived`.
create or replace function public.get_conversations()
returns table (
  id uuid, type text, name text, avatar_url text,
  other_id uuid, other_handle text, other_display_name text, other_avatar_url text,
  member_count int, last_body text, last_media boolean, last_shared boolean,
  last_sender_id uuid, last_at timestamptz, unread boolean, muted boolean, is_request boolean,
  archived boolean
) language sql stable security definer set search_path = '' as $fn$
  with mine as (
    select m.conversation_id, m.last_read_at, m.muted, m.archived
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
            where r.conversation_id = c.id and r.recipient_id = auth.uid() and r.status = 'pending'),
    mine.archived
  from public.conversations c
  join mine on mine.conversation_id = c.id
  left join last_msg lm on lm.conversation_id = c.id
  left join lateral (
    select p.id, p.handle, p.display_name, p.avatar_url
    from public.conversation_members m2 join public.profiles p on p.id = m2.user_id
    where m2.conversation_id = c.id and m2.user_id <> auth.uid() and c.type = 'direct'
    limit 1
  ) o on true
  order by coalesce(lm.created_at, c.created_at) desc;
$fn$;
revoke all on function public.get_conversations() from public;
grant execute on function public.get_conversations() to authenticated;

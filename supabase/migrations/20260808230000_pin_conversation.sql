-- ============================================================================
-- 20260808230000_pin_conversation
--
-- "Pin to top": a per-user flag on conversation_members (like muted/archived),
-- toggled via a SECURITY DEFINER RPC. get_conversations returns `pinned` and
-- orders pinned conversations first so they stay at the top of the inbox.
-- ============================================================================

alter table public.conversation_members
  add column if not exists pinned boolean not null default false;

create or replace function public.set_conversation_pinned(_cid uuid, _pinned boolean)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  update public.conversation_members
  set pinned = _pinned
  where conversation_id = _cid and user_id = auth.uid();
end $fn$;
revoke all on function public.set_conversation_pinned(uuid, boolean) from public;
grant execute on function public.set_conversation_pinned(uuid, boolean) to authenticated;

-- get_conversations, now returning `pinned` and sorting pinned-first. Adding a
-- return column changes the return type, so drop + recreate (not create-or-replace).
drop function if exists public.get_conversations();
create or replace function public.get_conversations()
returns table (
  id uuid, type text, name text, avatar_url text,
  other_id uuid, other_handle text, other_display_name text, other_avatar_url text,
  member_count int, last_body text, last_media boolean, last_shared boolean,
  last_sender_id uuid, last_at timestamptz, unread boolean, muted boolean, is_request boolean,
  archived boolean, pinned boolean
) language sql stable security definer set search_path = '' as $fn$
  with mine as (
    select m.conversation_id, m.last_read_at, m.muted, m.archived, m.pinned
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
    mine.archived,
    mine.pinned
  from public.conversations c
  join mine on mine.conversation_id = c.id
  left join last_msg lm on lm.conversation_id = c.id
  left join lateral (
    select p.id, p.handle, p.display_name, p.avatar_url
    from public.conversation_members m2 join public.profiles p on p.id = m2.user_id
    where m2.conversation_id = c.id and m2.user_id <> auth.uid() and c.type = 'direct'
    limit 1
  ) o on true
  order by mine.pinned desc, coalesce(lm.created_at, c.created_at) desc;
$fn$;
revoke all on function public.get_conversations() from public;
grant execute on function public.get_conversations() to authenticated;

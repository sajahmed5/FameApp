-- ============================================================================
-- 20260808220000_chat_details
--
-- Backing reads for the conversation "details" screen:
--   • get_conversation_media  — every image shared in a conversation (member-gated)
--   • get_shared_groups       — group conversations you AND another user both belong to
-- Both are SECURITY DEFINER + membership-checked, mirroring the other message RPCs.
-- ============================================================================

create or replace function public.get_conversation_media(_cid uuid)
returns table (message_id uuid, media_url text, created_at timestamptz)
language sql stable security definer set search_path = '' as $fn$
  select m.id, m.media_url, m.created_at
  from public.messages m
  where m.conversation_id = _cid
    and m.media_url is not null
    and m.deleted_at is null
    and public.is_conversation_member(_cid, auth.uid())
  order by m.created_at desc;
$fn$;
revoke all on function public.get_conversation_media(uuid) from public;
grant execute on function public.get_conversation_media(uuid) to authenticated;

-- Group conversations that both the caller and _other are members of.
create or replace function public.get_shared_groups(_other uuid)
returns table (id uuid, name text, avatar_url text, member_count int)
language sql stable security definer set search_path = '' as $fn$
  select c.id, c.name, c.avatar_url,
    (select count(*)::int from public.conversation_members m where m.conversation_id = c.id)
  from public.conversations c
  where c.type = 'group'
    and exists (select 1 from public.conversation_members me
                where me.conversation_id = c.id and me.user_id = auth.uid())
    and exists (select 1 from public.conversation_members ot
                where ot.conversation_id = c.id and ot.user_id = _other)
  order by c.created_at desc;
$fn$;
revoke all on function public.get_shared_groups(uuid) from public;
grant execute on function public.get_shared_groups(uuid) to authenticated;

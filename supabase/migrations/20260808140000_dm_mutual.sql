-- ============================================================================
-- 20260808140000_dm_mutual
--
-- DM routing rule change: a direct conversation lands straight in the recipient's
-- Messages ONLY when the two people MUTUALLY accept-follow each other. In every
-- other case (you follow them but they don't follow you, they follow you but you
-- don't follow them, or neither) it becomes a message REQUEST.
--
-- Previously it was one-directional (direct if the recipient followed the sender).
-- Only the request condition changes; everything else (can_dm, block/age checks,
-- the first-message-only request gate in send_message) is unchanged.
-- ============================================================================

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

  -- Gate behind a request UNLESS the two accept-follow each other (mutual).
  if not (
        exists (select 1 from public.follows f
                where f.follower_id = _other and f.followee_id = _me and f.status = 'accepted')
    and exists (select 1 from public.follows f
                where f.follower_id = _me and f.followee_id = _other and f.status = 'accepted')
  ) then
    insert into public.message_requests (conversation_id, recipient_id, status) values (_cid, _other, 'pending');
  end if;
  return _cid;
end $fn$;

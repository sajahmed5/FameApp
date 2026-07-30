-- ============================================================================
-- 20260808160000_message_reactions
--
-- Emoji reactions on direct/group messages. One reaction per user per message
-- (changeable). Members of the conversation can see reactions; you can only set/
-- clear your own (via the SECURITY DEFINER react_to_message).
-- ============================================================================

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_reactions enable row level security;
revoke all on public.message_reactions from anon, authenticated;

-- Members of the message's conversation may read its reactions.
create policy mr_select on public.message_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_conversation_member(m.conversation_id, auth.uid())
    )
  );

-- Set (or change) your reaction; empty emoji removes it.
create or replace function public.react_to_message(_message_id uuid, _emoji text)
returns void language plpgsql security definer set search_path = '' as $fn$
declare _cid uuid;
begin
  select conversation_id into _cid from public.messages where id = _message_id;
  if _cid is null or not public.is_conversation_member(_cid, auth.uid()) then
    raise exception 'not_allowed';
  end if;
  if _emoji is null or _emoji = '' then
    delete from public.message_reactions where message_id = _message_id and user_id = auth.uid();
  else
    insert into public.message_reactions (message_id, user_id, emoji)
    values (_message_id, auth.uid(), _emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end $fn$;
revoke all on function public.react_to_message(uuid, text) from public;
grant execute on function public.react_to_message(uuid, text) to authenticated;

-- All reactions for a conversation's messages (member-gated).
create or replace function public.get_message_reactions(_cid uuid)
returns table (message_id uuid, user_id uuid, emoji text)
language sql stable security definer set search_path = '' as $fn$
  select r.message_id, r.user_id, r.emoji
  from public.message_reactions r
  join public.messages m on m.id = r.message_id
  where m.conversation_id = _cid and public.is_conversation_member(_cid, auth.uid());
$fn$;
revoke all on function public.get_message_reactions(uuid) from public;
grant execute on function public.get_message_reactions(uuid) to authenticated;

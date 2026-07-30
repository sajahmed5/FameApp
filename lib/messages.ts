import { isStoragePath, signMediaPaths } from '@/lib/media';
import { awardMessageActivity } from '@/lib/points';
import { supabase } from '@/lib/supabase';

export type Conversation = {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  avatar_url: string | null;
  other_id: string | null;
  other_handle: string | null;
  other_display_name: string | null;
  other_avatar_url: string | null;
  member_count: number;
  last_body: string | null;
  last_media: boolean;
  last_shared: boolean;
  last_sender_id: string | null;
  last_at: string;
  unread: boolean;
  muted: boolean;
  is_request: boolean;
  archived: boolean;
};

export type Member = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  role: 'member' | 'admin';
  last_read_at: string | null;
};

export type ConversationDetail = {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  avatar_url: string | null;
  created_by: string | null;
  my_role: 'member' | 'admin';
  request_status: 'pending' | 'accepted' | 'rejected' | null;
  pending_incoming: boolean; // a request awaiting MY acceptance
  pending_outgoing: boolean; // I started a request, awaiting the other side
  members: Member[];
};

export type Message = {
  id: string;
  sender_id: string;
  sender_handle: string;
  sender_display_name: string;
  sender_avatar_url: string | null;
  body: string | null;
  media_url: string | null;
  shared_post_id: string | null;
  shared_thumb: string | null;
  shared_caption: string | null;
  shared_handle: string | null;
  reply_to_id: string | null;
  reply_body: string | null;
  reply_sender: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

// ---- reads ------------------------------------------------------------------
export async function getConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase.rpc('get_conversations');
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

export async function getConversation(id: string): Promise<ConversationDetail | null> {
  const { data, error } = await supabase.rpc('get_conversation', { _cid: id });
  if (error) throw error;
  return (data ?? null) as ConversationDetail | null;
}

export async function getMessages(cid: string, limit = 30, before?: string): Promise<Message[]> {
  const { data, error } = await supabase.rpc('get_messages', { _cid: cid, _limit: limit, _before: before ?? null });
  if (error) throw error;
  return resolveMessageMedia((data ?? []) as Message[]);
}

/** Sign the private-bucket keys on a batch of messages (message image + shared-post thumb). */
export async function resolveMessageMedia(msgs: Message[]): Promise<Message[]> {
  const paths: string[] = [];
  for (const m of msgs) {
    if (m.media_url && isStoragePath(m.media_url)) paths.push(m.media_url);
    if (m.shared_thumb && isStoragePath(m.shared_thumb)) paths.push(m.shared_thumb);
  }
  if (paths.length === 0) return msgs;
  const signed = await signMediaPaths(paths);
  return msgs.map((m) => ({
    ...m,
    media_url: m.media_url ? (signed.get(m.media_url) ?? m.media_url) : m.media_url,
    shared_thumb: m.shared_thumb ? (signed.get(m.shared_thumb) ?? m.shared_thumb) : m.shared_thumb,
  }));
}

// ---- mutations --------------------------------------------------------------
export async function startDirect(otherId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_direct', { _other: otherId });
  if (error) throw error;
  return data as string;
}
export async function createGroup(name: string, memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('create_group', { _name: name, _members: memberIds });
  if (error) throw error;
  return data as string;
}
export async function sendMessage(
  cid: string,
  opts: { body?: string; mediaUrl?: string; sharedPostId?: string; replyToId?: string },
): Promise<string> {
  const { data, error } = await supabase.rpc('send_message', {
    _cid: cid,
    _body: opts.body ?? null,
    _media_url: opts.mediaUrl ?? null,
    _shared_post_id: opts.sharedPostId ?? null,
    _reply_to_id: opts.replyToId ?? null,
  });
  if (error) throw error;
  awardMessageActivity(cid); // reward messaging (server-capped ~5/day)
  return data as string;
}
export async function respondToRequest(cid: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_to_request', { _cid: cid, _accept: accept });
  if (error) throw error;
}
export async function markRead(cid: string): Promise<void> {
  await supabase.rpc('mark_conversation_read', { _cid: cid });
}
export async function setMuted(cid: string, muted: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_conversation_muted', { _cid: cid, _muted: muted });
  if (error) throw error;
}
export async function leaveConversation(cid: string): Promise<void> {
  const { error } = await supabase.rpc('leave_conversation', { _cid: cid });
  if (error) throw error;
}
export async function addGroupMember(cid: string, uid: string): Promise<void> {
  const { error } = await supabase.rpc('add_group_member', { _cid: cid, _uid: uid });
  if (error) throw error;
}
export async function removeGroupMember(cid: string, uid: string): Promise<void> {
  const { error } = await supabase.rpc('remove_group_member', { _cid: cid, _uid: uid });
  if (error) throw error;
}
export async function deleteMessage(mid: string): Promise<void> {
  const { error } = await supabase.rpc('delete_message', { _mid: mid });
  if (error) throw error;
}
export async function reportMessage(mid: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('report_message', { _mid: mid, _reason: reason });
  if (error) throw error;
}
export async function reportConversation(cid: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('report_conversation', { _cid: cid, _reason: reason });
  if (error) throw error;
}

// ---- realtime ---------------------------------------------------------------
/**
 * Subscribe to a thread: new/edited messages, read-position (member) changes, and
 * ephemeral typing broadcasts. Returns an unsubscribe + a typing sender bound to
 * the same channel. RLS applies to postgres_changes, so only members receive rows.
 */
export function subscribeToThread(
  cid: string,
  handlers: {
    onMessage: (row: { id: string }) => void;
    onMemberChange: () => void;
    onTyping: (payload: { userId: string; handle: string }) => void;
  },
): { unsubscribe: () => void; sendTyping: (userId: string, handle: string) => void } {
  const channel = supabase.channel(`conv:${cid}`, { config: { broadcast: { self: false } } });
  channel
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${cid}` }, (p) => handlers.onMessage(p.new as { id: string }))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${cid}` }, (p) => handlers.onMessage(p.new as { id: string }))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${cid}` }, () => handlers.onMemberChange())
    .on('broadcast', { event: 'typing' }, ({ payload }) => handlers.onTyping(payload as { userId: string; handle: string }))
    .subscribe();
  return {
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
    sendTyping: (userId, handle) => {
      void channel.send({ type: 'broadcast', event: 'typing', payload: { userId, handle } });
    },
  };
}

/** Refresh the inbox when any message lands in one of my conversations (RLS-filtered). */
export type MessageReaction = { message_id: string; user_id: string; emoji: string };

/** All emoji reactions for a conversation's messages (member-gated). */
export async function getMessageReactions(cid: string): Promise<MessageReaction[]> {
  const { data, error } = await supabase.rpc('get_message_reactions', { _cid: cid });
  if (error) throw error;
  return (data ?? []) as MessageReaction[];
}

/** Set/change your reaction on a message; empty emoji clears it. */
export async function reactToMessage(messageId: string, emoji: string): Promise<void> {
  const { error } = await supabase.rpc('react_to_message', { _message_id: messageId, _emoji: emoji });
  if (error) throw error;
}

/** Realtime: fire on any reaction change (INSERT/UPDATE/DELETE). */
export function subscribeToReactions(onChange: () => void): () => void {
  const channel = supabase
    .channel('reactions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => onChange())
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Archive or unarchive a conversation for me (hidden from the main inbox). */
export async function setConversationArchived(cid: string, archived: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_conversation_archived', { _cid: cid, _archived: archived });
  if (error) throw error;
}

/** Mark a conversation unread (rewinds my read cursor to before the last message). */
export async function markConversationUnread(cid: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_unread', { _cid: cid });
  if (error) throw error;
}

export function subscribeToInbox(onChange: () => void): () => void {
  const channel = supabase
    .channel('inbox')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => onChange())
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

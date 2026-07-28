import { supabase } from '@/lib/supabase';

/** Fixed reaction set (must match is_allowed_reaction in the DB). */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'] as const;

export const COMMENT_MAX_LENGTH = 1000;
export const COMMENTS_PAGE_SIZE = 20;

/** A comment as returned by get_comments / get_replies. */
export type CommentView = {
  id: string;
  post_id: string;
  user_id: string;
  parent_id: string | null;
  body: string | null; // null when deleted (tombstone)
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  is_own: boolean;
  author_handle: string;
  author_name: string;
  author_avatar: string | null;
  reply_count: number;
  reaction_counts: Record<string, number>;
  my_reactions: string[];
  /** Client-only: optimistic write state ('pending' in flight, 'failed' → offer retry). */
  _status?: 'pending' | 'failed';
};

type RawCommentRow = Omit<CommentView, 'reply_count'> & { reply_count: number | string };

function mapRow(r: RawCommentRow): CommentView {
  return {
    ...r,
    reply_count: Number(r.reply_count ?? 0),
    reaction_counts: r.reaction_counts ?? {},
    my_reactions: r.my_reactions ?? [],
  };
}

/** Top-level comments, newest first. Pass the oldest loaded `created_at` to page. */
export async function fetchComments(
  postId: string,
  before?: string,
  limit = COMMENTS_PAGE_SIZE,
): Promise<CommentView[]> {
  const { data, error } = await supabase.rpc('get_comments', {
    _post_id: postId,
    _limit: limit,
    _before: before ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as RawCommentRow[]).map(mapRow);
}

/** Replies to a comment, oldest first (one level only). */
export async function fetchReplies(parentId: string, after?: string): Promise<CommentView[]> {
  const { data, error } = await supabase.rpc('get_replies', {
    _parent_id: parentId,
    _after: after ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as RawCommentRow[]).map(mapRow);
}

/** The raw row add_comment returns (author is the current user; the hook enriches). */
export type NewCommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  parent_comment_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
};

export async function addComment(
  postId: string,
  body: string,
  parentId?: string,
): Promise<NewCommentRow> {
  const { data, error } = await supabase.rpc('add_comment', {
    _post_id: postId,
    _body: body,
    _parent_id: parentId ?? null,
  });
  if (error) throw error;
  return data as NewCommentRow;
}

/** Returns true if the comment was tombstoned (kept for its replies), false if removed. */
export async function deleteComment(commentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_comment', { _comment_id: commentId });
  if (error) throw error;
  return Boolean(data);
}

export async function editComment(commentId: string, body: string): Promise<void> {
  const { error } = await supabase
    .from('comments')
    .update({ body: body.trim() })
    .eq('id', commentId);
  if (error) throw error;
}

/** Returns true if the reaction is now present, false if it was removed. */
export async function toggleReaction(commentId: string, emoji: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('toggle_reaction', {
    _comment_id: commentId,
    _emoji: emoji,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function reportComment(
  commentId: string,
  reason: string,
  detail?: string,
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const reporterId = auth.user?.id;
  if (!reporterId) throw new Error('Not authenticated');
  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    target_type: 'comment',
    target_id: commentId,
    reason,
    detail: detail ?? null,
    status: 'open',
  });
  if (error) throw error;
}

export async function blockUser(blockedId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const blockerId = auth.user?.id;
  if (!blockerId) throw new Error('Not authenticated');
  const { error } = await supabase.from('blocks').insert({
    blocker_id: blockerId,
    blocked_id: blockedId,
  });
  if (error) throw error;
}

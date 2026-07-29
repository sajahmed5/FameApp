import { useCallback, useEffect, useRef, useState } from 'react';

import { trackFirst } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import {
  addComment,
  blockUser,
  COMMENTS_PAGE_SIZE,
  deleteComment,
  editComment,
  fetchComments,
  fetchReplies,
  reportComment,
  toggleReaction,
  type CommentView,
  type NewCommentRow,
} from '@/lib/comments';

export type CommentsStatus = 'loading' | 'ready' | 'error';

let tempSeq = 0;

/** Owns the comment thread for one post: paging, replies, and optimistic writes. */
export function useComments(postId: string, onCountDelta?: (delta: number) => void) {
  const { profile, user } = useAuth();

  const [comments, setComments] = useState<CommentView[]>([]);
  const [status, setStatus] = useState<CommentsStatus>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [repliesByParent, setRepliesByParent] = useState<Record<string, CommentView[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingReplies, setLoadingReplies] = useState<Set<string>>(new Set());

  const loadingMoreRef = useRef(false);

  // --- helpers ---------------------------------------------------------------
  const updateOne = useCallback((id: string, fn: (c: CommentView) => CommentView) => {
    setComments((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
    setRepliesByParent((prev) => {
      let touched = false;
      const next: Record<string, CommentView[]> = {};
      for (const [pid, list] of Object.entries(prev)) {
        next[pid] = list.map((c) => {
          if (c.id !== id) return c;
          touched = true;
          return fn(c);
        });
      }
      return touched ? next : prev;
    });
  }, []);

  const optimisticFrom = useCallback(
    (body: string, parentId: string | null): CommentView => {
      tempSeq += 1;
      return {
        id: `temp-${Date.now()}-${tempSeq}`,
        post_id: postId,
        user_id: user?.id ?? '',
        parent_id: parentId,
        body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_deleted: false,
        is_own: true,
        author_handle: profile?.handle ?? 'you',
        author_name: profile?.display_name ?? 'You',
        author_avatar: profile?.avatar_url ?? null,
        reply_count: 0,
        reaction_counts: {},
        my_reactions: [],
        _status: 'pending',
      };
    },
    [postId, user?.id, profile],
  );

  const reconcile = useCallback((tempId: string, row: NewCommentRow, parentId: string | null) => {
    const real: Partial<CommentView> = {
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      body: row.body,
      _status: undefined,
    };
    if (parentId) {
      setRepliesByParent((prev) => ({
        ...prev,
        [parentId]: (prev[parentId] ?? []).map((c) => (c.id === tempId ? { ...c, ...real } : c)),
      }));
    } else {
      setComments((prev) => prev.map((c) => (c.id === tempId ? { ...c, ...real } : c)));
    }
  }, []);

  const markFailed = useCallback((tempId: string, parentId: string | null) => {
    if (parentId) {
      setRepliesByParent((prev) => ({
        ...prev,
        [parentId]: (prev[parentId] ?? []).map((c) =>
          c.id === tempId ? { ...c, _status: 'failed' } : c,
        ),
      }));
    } else {
      setComments((prev) => prev.map((c) => (c.id === tempId ? { ...c, _status: 'failed' } : c)));
    }
  }, []);

  // --- loading ---------------------------------------------------------------
  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const first = await fetchComments(postId);
      setComments(first);
      setHasMore(first.length === COMMENTS_PAGE_SIZE);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [postId]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const first = await fetchComments(postId);
      setComments(first);
      setHasMore(first.length === COMMENTS_PAGE_SIZE);
      setRepliesByParent({});
      setExpanded(new Set());
      setStatus('ready');
    } catch {
      // keep current list on a failed refresh
    } finally {
      setRefreshing(false);
    }
  }, [postId]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    const oldest = comments[comments.length - 1];
    if (!oldest) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const older = await fetchComments(postId, oldest.created_at);
      setComments((prev) => [...prev, ...older.filter((o) => !prev.some((p) => p.id === o.id))]);
      setHasMore(older.length === COMMENTS_PAGE_SIZE);
    } catch {
      // leave hasMore; user can scroll again to retry
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [comments, hasMore, postId]);

  // --- replies ---------------------------------------------------------------
  const toggleReplies = useCallback(
    async (parentId: string) => {
      const isOpen = expanded.has(parentId);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (isOpen) next.delete(parentId);
        else next.add(parentId);
        return next;
      });
      if (isOpen || repliesByParent[parentId]) return; // collapsing, or already loaded
      setLoadingReplies((prev) => new Set(prev).add(parentId));
      try {
        const replies = await fetchReplies(parentId);
        setRepliesByParent((prev) => ({ ...prev, [parentId]: replies }));
      } catch {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(parentId);
          return next;
        });
      } finally {
        setLoadingReplies((prev) => {
          const next = new Set(prev);
          next.delete(parentId);
          return next;
        });
      }
    },
    [expanded, repliesByParent],
  );

  // --- write actions ---------------------------------------------------------
  const submit = useCallback(
    async (body: string, parentId: string | null) => {
      const text = body.trim();
      if (!text) return;
      const optimistic = optimisticFrom(text, parentId);
      if (parentId) {
        setRepliesByParent((prev) => ({
          ...prev,
          [parentId]: [...(prev[parentId] ?? []), optimistic],
        }));
        setExpanded((prev) => new Set(prev).add(parentId));
        updateOne(parentId, (c) => ({ ...c, reply_count: c.reply_count + 1 }));
      } else {
        setComments((prev) => [optimistic, ...prev]);
      }
      onCountDelta?.(1);
      try {
        const row = await addComment(postId, text, parentId ?? undefined);
        reconcile(optimistic.id, row, parentId);
        if (user?.id) void trackFirst(user.id, 'first_comment'); // no post/comment id sent
      } catch {
        markFailed(optimistic.id, parentId);
      }
    },
    [optimisticFrom, onCountDelta, postId, reconcile, markFailed, updateOne, user?.id],
  );

  const retry = useCallback(
    async (comment: CommentView) => {
      const parentId = comment.parent_id;
      updateOne(comment.id, (c) => ({ ...c, _status: 'pending' }));
      try {
        const row = await addComment(postId, comment.body ?? '', parentId ?? undefined);
        reconcile(comment.id, row, parentId);
      } catch {
        markFailed(comment.id, parentId);
      }
    },
    [postId, reconcile, markFailed, updateOne],
  );

  const remove = useCallback(
    async (comment: CommentView) => {
      try {
        const tombstoned = await deleteComment(comment.id);
        if (tombstoned) {
          updateOne(comment.id, (c) => ({ ...c, is_deleted: true, body: null }));
        } else {
          // hard removed
          if (comment.parent_id) {
            setRepliesByParent((prev) => ({
              ...prev,
              [comment.parent_id!]: (prev[comment.parent_id!] ?? []).filter(
                (c) => c.id !== comment.id,
              ),
            }));
            updateOne(comment.parent_id, (c) => ({
              ...c,
              reply_count: Math.max(0, c.reply_count - 1),
            }));
          } else {
            setComments((prev) => prev.filter((c) => c.id !== comment.id));
          }
          onCountDelta?.(-1);
        }
      } catch {
        // surfaced by the caller via a thrown/failed state; keep the comment
        throw new Error('delete-failed');
      }
    },
    [onCountDelta, updateOne],
  );

  const edit = useCallback(
    async (comment: CommentView, body: string) => {
      const text = body.trim();
      if (!text) return;
      const prevBody = comment.body;
      updateOne(comment.id, (c) => ({ ...c, body: text }));
      try {
        await editComment(comment.id, text);
      } catch {
        updateOne(comment.id, (c) => ({ ...c, body: prevBody }));
        throw new Error('edit-failed');
      }
    },
    [updateOne],
  );

  const react = useCallback(
    async (comment: CommentView, emoji: string) => {
      const had = comment.my_reactions.includes(emoji);
      // optimistic
      updateOne(comment.id, (c) => {
        const counts = { ...c.reaction_counts };
        const mine = new Set(c.my_reactions);
        if (had) {
          mine.delete(emoji);
          counts[emoji] = Math.max(0, (counts[emoji] ?? 1) - 1);
          if (counts[emoji] === 0) delete counts[emoji];
        } else {
          mine.add(emoji);
          counts[emoji] = (counts[emoji] ?? 0) + 1;
        }
        return { ...c, reaction_counts: counts, my_reactions: [...mine] };
      });
      try {
        await toggleReaction(comment.id, emoji);
      } catch {
        // revert
        updateOne(comment.id, (c) => {
          const counts = { ...c.reaction_counts };
          const mine = new Set(c.my_reactions);
          if (had) {
            mine.add(emoji);
            counts[emoji] = (counts[emoji] ?? 0) + 1;
          } else {
            mine.delete(emoji);
            counts[emoji] = Math.max(0, (counts[emoji] ?? 1) - 1);
            if (counts[emoji] === 0) delete counts[emoji];
          }
          return { ...c, reaction_counts: counts, my_reactions: [...mine] };
        });
      }
    },
    [updateOne],
  );

  const report = useCallback(async (comment: CommentView, reason: string) => {
    await reportComment(comment.id, reason);
  }, []);

  const block = useCallback(async (userId: string) => {
    await blockUser(userId);
    // Remove that user's comments/replies from the current view immediately.
    setComments((prev) => prev.filter((c) => c.user_id !== userId));
    setRepliesByParent((prev) => {
      const next: Record<string, CommentView[]> = {};
      for (const [pid, list] of Object.entries(prev)) {
        next[pid] = list.filter((c) => c.user_id !== userId);
      }
      return next;
    });
  }, []);

  return {
    comments,
    status,
    refreshing,
    hasMore,
    loadingMore,
    repliesByParent,
    expanded,
    loadingReplies,
    load,
    refresh,
    loadMore,
    toggleReplies,
    submit,
    retry,
    remove,
    edit,
    react,
    report,
    block,
  };
}

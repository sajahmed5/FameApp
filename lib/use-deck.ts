import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth-context';
import { DECK_BATCH_SIZE, fetchDeck, type DeckCard, type SwipeDirection } from '@/lib/deck';
import { SwipeQueue } from '@/lib/swipe-queue';

export type DeckStatus = 'loading' | 'ready' | 'exhausted' | 'error';

// Start fetching the next batch once the buffer drops to ~card 5 of the current 20.
const REFILL_AT = DECK_BATCH_SIZE - 5;
// Warm the media for the next few cards so they don't pop in.
const PREFETCH_AHEAD = 3;

export type UseDeck = {
  cards: DeckCard[];
  status: DeckStatus;
  canUndo: boolean;
  pendingWrites: number;
  swipe: (direction: SwipeDirection) => void;
  undo: () => void;
  retry: () => void;
  adjustCommentCount: (id: string, delta: number) => void;
};

/** Owns the worldwide deck: candidate buffer, prefetch, optimistic swipes, undo. */
export function useDeck(): UseDeck {
  const { user } = useAuth();
  const uid = user?.id;

  const [cards, setCards] = useState<DeckCard[]>([]);
  const [status, setStatus] = useState<DeckStatus>('loading');
  const [lastSwiped, setLastSwiped] = useState<DeckCard | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);

  // All post ids ever loaded this session — passed as the deck's exclude list so the
  // server never re-serves a card already in (or already gone from) the buffer.
  const loadedIds = useRef<Set<string>>(new Set());
  const fetchingMore = useRef(false);
  const queueRef = useRef<SwipeQueue | null>(null);

  const prefetchMedia = useCallback((list: DeckCard[]) => {
    for (const card of list.slice(0, PREFETCH_AHEAD)) {
      // Images: warm the full-bleed image. Videos: warm the poster thumbnail.
      const url = card.media_type === 'image' ? card.media_url : card.thumbnail_url;
      if (url) void Image.prefetch(url);
    }
  }, []);

  const loadInitial = useCallback(async () => {
    if (!uid) return;
    setStatus('loading');
    loadedIds.current = new Set();
    try {
      const batch = await fetchDeck([]);
      batch.forEach((c) => loadedIds.current.add(c.id));
      setCards(batch);
      setLastSwiped(null);
      setStatus(batch.length === 0 ? 'exhausted' : 'ready');
      prefetchMedia(batch);
    } catch {
      setStatus('error');
    }
  }, [uid, prefetchMedia]);

  const fetchMore = useCallback(async () => {
    if (fetchingMore.current) return;
    fetchingMore.current = true;
    try {
      const batch = await fetchDeck([...loadedIds.current]);
      const fresh = batch.filter((c) => !loadedIds.current.has(c.id));
      fresh.forEach((c) => loadedIds.current.add(c.id));
      if (fresh.length) {
        setCards((prev) => {
          const next = [...prev, ...fresh];
          if (prev.length === 0) prefetchMedia(next);
          return next;
        });
      }
      // Mark exhausted only when nothing new AND the buffer has drained.
      setCards((prev) => {
        if (fresh.length === 0 && prev.length === 0) setStatus('exhausted');
        return prev;
      });
    } catch {
      // A background refill failure shouldn't blow away a usable buffer; only surface an
      // error when there's nothing to show.
      setCards((prev) => {
        if (prev.length === 0) setStatus('error');
        return prev;
      });
    } finally {
      fetchingMore.current = false;
    }
  }, [prefetchMedia]);

  // Bootstrap: swipe queue + first batch, per user.
  useEffect(() => {
    if (!uid) return;
    const queue = new SwipeQueue(uid, setPendingWrites);
    queueRef.current = queue;
    void queue.init();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInitial();
    return () => {
      queue.dispose();
      queueRef.current = null;
    };
  }, [uid, loadInitial]);

  const swipe = useCallback(
    (direction: SwipeDirection) => {
      setCards((prev) => {
        if (prev.length === 0) return prev;
        const [top, ...rest] = prev;
        setLastSwiped(top);
        queueRef.current?.enqueueSwipe(top.id, direction);
        prefetchMedia(rest);
        if (rest.length <= REFILL_AT) void fetchMore();
        if (rest.length === 0) void fetchMore();
        return rest;
      });
    },
    [fetchMore, prefetchMedia],
  );

  const undo = useCallback(() => {
    setLastSwiped((prev) => {
      if (!prev) return null;
      queueRef.current?.enqueueUndo(prev.id);
      setCards((cs) => [prev, ...cs]);
      setStatus((s) => (s === 'exhausted' ? 'ready' : s));
      return null; // single step back only
    });
  }, []);

  const retry = useCallback(() => {
    void loadInitial();
    queueRef.current?.flush();
  }, [loadInitial]);

  // Keep a card's comment count roughly in sync while its comment sheet is open.
  const adjustCommentCount = useCallback((id: string, delta: number) => {
    setCards((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, comment_count: Math.max(0, c.comment_count + delta) } : c,
      ),
    );
  }, []);

  return {
    cards,
    status,
    canUndo: lastSwiped !== null,
    pendingWrites,
    swipe,
    undo,
    retry,
    adjustCommentCount,
  };
}

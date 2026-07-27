import { supabase } from '@/lib/supabase';

/** A card returned by the `get_deck` RPC. */
export type DeckCard = {
  id: string;
  user_id: string;
  media_url: string;
  thumbnail_url: string;
  media_type: 'image' | 'video';
  caption: string | null;
  alt_text: string | null;
  like_count: number;
  skip_count: number;
  comment_count: number;
  created_at: string;
  poster_handle: string;
  poster_display_name: string;
  poster_avatar_url: string | null;
  tags: string[];
};

export type SwipeDirection = 'left' | 'right';

export const DECK_BATCH_SIZE = 20;

/** Fetch a ranked batch, excluding posts already loaded into the client deck. */
export async function fetchDeck(exclude: string[], limit = DECK_BATCH_SIZE): Promise<DeckCard[]> {
  const { data, error } = await supabase.rpc('get_deck', {
    _limit: limit,
    _exclude: exclude,
  });
  if (error) throw error;
  return (data ?? []) as DeckCard[];
}

/**
 * Record a swipe server-side: the client submits only the action (post + direction);
 * the server inserts the swipe and decides the points award. Idempotent, so retrying a
 * queued swipe is safe. Returns the new points balance.
 */
export async function recordSwipe(postId: string, direction: SwipeDirection): Promise<number> {
  const { data, error } = await supabase.rpc('record_swipe', {
    _post_id: postId,
    _direction: direction,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** Reverse a single swipe: deletes the swipe row and posts a compensating ledger entry. */
export async function undoSwipe(postId: string): Promise<number> {
  const { data, error } = await supabase.rpc('undo_swipe', { _post_id: postId });
  if (error) throw error;
  return Number(data ?? 0);
}

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

/**
 * A batch fetcher shared by both feeds. Takes the exclude list of ids already loaded
 * into the client deck; returns the next candidate batch. Home and Following pass
 * different implementations so `useDeck` stays feed-agnostic.
 */
export type FetchBatch = (exclude: string[], limit?: number) => Promise<DeckCard[]>;

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
 * Fetch a batch of the Following feed: unranked, strictly newest-first, drawn only from
 * accounts the caller accepted-follows. Same shape/paging as `fetchDeck` so the two feeds
 * share the deck machinery and the swipe/points/undo path unchanged.
 */
export async function fetchFollowingDeck(
  exclude: string[],
  limit = DECK_BATCH_SIZE,
): Promise<DeckCard[]> {
  const { data, error } = await supabase.rpc('get_following_deck', {
    _limit: limit,
    _exclude: exclude,
  });
  if (error) throw error;
  return (data ?? []) as DeckCard[];
}

/**
 * A page of the PERSISTENT Following feed (Instagram/TikTok-style): all recent posts
 * from accepted-follow accounts, newest-first, NOT consumed by swiping. Cursor-paginated
 * by the created_at of the last card you loaded (pass null for the first page).
 */
export async function fetchFollowingFeed(
  before: string | null,
  limit = 15,
): Promise<DeckCard[]> {
  const { data, error } = await supabase.rpc('get_following_feed', {
    _limit: limit,
    _before: before,
  });
  if (error) throw error;
  return (data ?? []) as DeckCard[];
}

/** Counts that let the Following tab pick the right empty state. */
export type FollowingSummary = {
  following_count: number;
  postable_count: number;
};

/**
 * How many accounts the caller follows, and how many eligible posts those accounts have
 * (ignoring swipes). Lets the Following tab tell "you follow nobody" from "nobody you
 * follow has posted" from "you're caught up".
 */
export async function getFollowingSummary(): Promise<FollowingSummary> {
  const { data, error } = await supabase.rpc('get_following_summary');
  if (error) throw error;
  const row = (data?.[0] ?? { following_count: 0, postable_count: 0 }) as FollowingSummary;
  return {
    following_count: Number(row.following_count ?? 0),
    postable_count: Number(row.postable_count ?? 0),
  };
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

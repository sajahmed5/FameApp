import { supabase } from '@/lib/supabase';
import type { DeckCard } from '@/lib/deck';

const MEDIA_BUCKET = 'media';
const SIGNED_URL_TTL = 60 * 60 * 2; // 2 hours — comfortably longer than a deck session

/**
 * A post's media_url / thumbnail_url is an object KEY in the private `media` bucket
 * (set by the upload pipeline). Seed/legacy rows may instead hold a full http URL.
 * This tells them apart so we only sign the ones that need it.
 */
export function isStoragePath(value: string): boolean {
  return !!value && !/^https?:\/\//i.test(value) && !value.startsWith('data:');
}

/** Batch-sign object keys. Returns a key→signed-URL map; unreadable keys are omitted. */
export async function signMediaPaths(paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(paths.filter(isStoragePath))];
  if (unique.length === 0) return map;
  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL);
  if (error || !data) return map;
  for (const row of data) {
    if (row.signedUrl && row.path) map.set(row.path, row.signedUrl);
  }
  return map;
}

/**
 * Resolve a deck batch's media for display: sign any storage-key media_url /
 * thumbnail_url in one round-trip, leaving already-absolute URLs untouched. RLS on
 * the bucket mirrors post visibility, so signing only succeeds for media the caller
 * is allowed to see.
 */
export async function resolveDeckMedia(cards: DeckCard[]): Promise<DeckCard[]> {
  if (cards.length === 0) return cards;
  const paths: string[] = [];
  for (const c of cards) {
    if (isStoragePath(c.media_url)) paths.push(c.media_url);
    if (isStoragePath(c.thumbnail_url)) paths.push(c.thumbnail_url);
  }
  // Signing and the carousel counts are independent — run them together so the
  // count costs no extra latency on the deck's critical path.
  const [signed, counts] = await Promise.all([
    paths.length ? signMediaPaths(paths) : Promise.resolve(new Map<string, string>()),
    carouselCounts(cards.map((c) => c.id)),
  ]);
  return cards.map((c) => ({
    ...c,
    media_url: signed.get(c.media_url) ?? c.media_url,
    thumbnail_url: signed.get(c.thumbnail_url) ?? c.thumbnail_url,
    media_count: counts.get(c.id) ?? 1,
  }));
}

/**
 * How many media items each post has (1 = single, >1 = carousel). Counts the extra
 * `post_media` rows and adds the cover. Never throws — if the query fails the deck
 * simply shows no carousel badge rather than failing to load.
 */
async function carouselCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from('post_media').select('post_id').in('post_id', ids);
  if (error || !data) return out;
  for (const row of data as { post_id: string }[]) {
    out.set(row.post_id, (out.get(row.post_id) ?? 1) + 1);
  }
  return out;
}

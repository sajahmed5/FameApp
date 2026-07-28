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
  const paths: string[] = [];
  for (const c of cards) {
    if (isStoragePath(c.media_url)) paths.push(c.media_url);
    if (isStoragePath(c.thumbnail_url)) paths.push(c.thumbnail_url);
  }
  if (paths.length === 0) return cards;
  const signed = await signMediaPaths(paths);
  return cards.map((c) => ({
    ...c,
    media_url: signed.get(c.media_url) ?? c.media_url,
    thumbnail_url: signed.get(c.thumbnail_url) ?? c.thumbnail_url,
  }));
}

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
  // Signing the covers and loading the carousel extras are independent — run them
  // together so carousels cost no extra latency on the deck's critical path.
  const [signed, extrasMap] = await Promise.all([
    paths.length ? signMediaPaths(paths) : Promise.resolve(new Map<string, string>()),
    carouselExtras(cards.map((c) => c.id)),
  ]);
  return cards.map((c) => {
    const media_url = signed.get(c.media_url) ?? c.media_url;
    const extras = extrasMap.get(c.id);
    return {
      ...c,
      media_url,
      thumbnail_url: signed.get(c.thumbnail_url) ?? c.thumbnail_url,
      media_count: 1 + (extras?.length ?? 0),
      // Cover first, then the extras in position order — what the deck pages through.
      carousel: extras?.length
        ? [{ media_url, media_type: c.media_type }, ...extras]
        : undefined,
    };
  });
}

type CarouselItem = { media_url: string; media_type: 'image' | 'video' };

/**
 * The extra (position >= 1) media for each post, signed and in order. Never throws —
 * if the query fails the cards simply render as single-media rather than failing.
 */
async function carouselExtras(ids: string[]): Promise<Map<string, CarouselItem[]>> {
  const out = new Map<string, CarouselItem[]>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from('post_media')
    .select('post_id, position, media_url, media_type')
    .in('post_id', ids)
    .order('position', { ascending: true });
  if (error || !data) return out;
  const rows = data as { post_id: string; media_url: string; media_type: 'image' | 'video' }[];
  if (rows.length === 0) return out;
  const signed = await signMediaPaths(rows.map((r) => r.media_url).filter(isStoragePath));
  for (const r of rows) {
    const list = out.get(r.post_id) ?? [];
    list.push({ media_url: signed.get(r.media_url) ?? r.media_url, media_type: r.media_type });
    out.set(r.post_id, list);
  }
  return out;
}

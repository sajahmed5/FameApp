import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DeckCard, FetchBatch } from '@/lib/deck';
import { resolveDeckMedia } from '@/lib/media';
import { supabase } from '@/lib/supabase';

export type SearchMode = 'worldwide' | 'local' | 'tags' | 'accounts';

export type SearchPost = DeckCard;

export type AccountHit = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  follower_count: number;
  is_private: boolean;
  follow_status: 'pending' | 'accepted' | null;
};

export type TagHit = { name: string; usage_count: number; is_following: boolean };
export type TagMeta = { name: string; post_count: number; is_following: boolean };
export type GeoPlace = { label: string; lat: number; lon: number };
export type SearchSettings = { radius_miles: number; center_label: string | null; has_actual_location: boolean };

export const PAGE = 24;
export const ACCOUNTS_PAGE = 20;

// ---- posts (worldwide / local) --------------------------------------------
export async function searchPosts(
  mode: 'worldwide' | 'local',
  q: string,
  offset = 0,
  limit = PAGE,
): Promise<SearchPost[]> {
  const fn = mode === 'local' ? 'search_posts_local' : 'search_posts';
  const { data, error } = await supabase.rpc(fn, { _q: q, _limit: limit, _offset: offset });
  if (error) throw error;
  return resolveDeckMedia((data ?? []) as DeckCard[]);
}

/**
 * A deck fetcher seeded from a search: paginates the same result set the grid
 * showed so tapping a result opens a swipe deck. Returns raw cards (useDeck
 * resolves media). Stateful offset in a closure — build once per (mode,q,tag).
 */
export function makeSearchDeckFetcher(opts: { mode: SearchMode; q?: string; tag?: string; start?: number }): FetchBatch {
  let offset = Math.max(0, opts.start ?? 0);
  return async () => {
    const fn = opts.tag ? 'search_posts_by_tag' : opts.mode === 'local' ? 'search_posts_local' : 'search_posts';
    const params = opts.tag
      ? { _name: opts.tag, _limit: PAGE, _offset: offset }
      : { _q: opts.q ?? '', _limit: PAGE, _offset: offset };
    const { data, error } = await supabase.rpc(fn, params);
    if (error) throw error;
    offset += PAGE;
    return (data ?? []) as DeckCard[];
  };
}

// ---- accounts --------------------------------------------------------------
export async function searchAccounts(q: string, offset = 0, limit = ACCOUNTS_PAGE): Promise<AccountHit[]> {
  const { data, error } = await supabase.rpc('search_accounts', { _q: q, _limit: limit, _offset: offset });
  if (error) throw error;
  return (data ?? []) as AccountHit[];
}

export async function followAccount(id: string, isPrivate: boolean): Promise<'pending' | 'accepted'> {
  const { data: u } = await supabase.auth.getUser();
  const status = isPrivate ? 'pending' : 'accepted';
  const { error } = await supabase.from('follows').insert({ follower_id: u.user!.id, followee_id: id, status });
  if (error && error.code !== '23505') throw error;
  return status;
}
export async function unfollowAccount(id: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('follows').delete().eq('follower_id', u.user!.id).eq('followee_id', id);
  if (error) throw error;
}

// ---- tags ------------------------------------------------------------------
export async function searchTags(q: string, limit = 20): Promise<TagHit[]> {
  const { data, error } = await supabase.rpc('search_tags', { _q: q, _limit: limit });
  if (error) throw error;
  return (data ?? []) as TagHit[];
}
export async function trendingTags(limit = 20): Promise<TagHit[]> {
  const { data, error } = await supabase.rpc('trending_tags', { _limit: limit });
  if (error) throw error;
  return (data ?? []) as TagHit[];
}
export async function getTagMeta(name: string): Promise<TagMeta | null> {
  const { data, error } = await supabase.rpc('get_tag_meta', { _name: name });
  if (error) throw error;
  return ((data ?? [])[0] ?? null) as TagMeta | null;
}
export async function searchPostsByTag(name: string, offset = 0, limit = PAGE): Promise<SearchPost[]> {
  const { data, error } = await supabase.rpc('search_posts_by_tag', { _name: name, _limit: limit, _offset: offset });
  if (error) throw error;
  return resolveDeckMedia((data ?? []) as DeckCard[]);
}
export async function followTag(name: string): Promise<void> {
  const { error } = await supabase.rpc('follow_tag', { _name: name });
  if (error) throw error;
}
export async function unfollowTag(name: string): Promise<void> {
  const { error } = await supabase.rpc('unfollow_tag', { _name: name });
  if (error) throw error;
}

// ---- relocatable search centre --------------------------------------------
export async function getSearchSettings(): Promise<SearchSettings> {
  const { data, error } = await supabase.rpc('get_search_settings');
  if (error) throw error;
  const row = ((data ?? [])[0] ?? { radius_miles: 5, center_label: null, has_actual_location: false }) as SearchSettings;
  return { radius_miles: Number(row.radius_miles ?? 5), center_label: row.center_label ?? null, has_actual_location: !!row.has_actual_location };
}
export async function setSearchCenter(lat: number, lon: number, label: string): Promise<void> {
  const { error } = await supabase.rpc('set_search_center', { _lat: lat, _lon: lon, _label: label });
  if (error) throw error;
}
export async function resetSearchCenter(): Promise<void> {
  const { error } = await supabase.rpc('reset_search_center');
  if (error) throw error;
}
export async function setSearchRadius(miles: number): Promise<void> {
  const { error } = await supabase.rpc('set_search_radius', { _miles: miles });
  if (error) throw error;
}

/** Forward place search for relocation — keeps the Places key server-side. */
export async function geocodePlaces(query: string): Promise<GeoPlace[]> {
  const { data, error } = await supabase.functions.invoke('places', { body: { action: 'geocode', query } });
  if (error) throw error;
  return ((data as { places?: GeoPlace[] })?.places ?? []).filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number');
}

// ---- recent searches (local, clearable) -----------------------------------
const RECENT_KEY = 'fame:recent-searches';
const RECENT_MAX = 12;
export type RecentSearch = { term: string; mode: SearchMode };

export async function getRecentSearches(): Promise<RecentSearch[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as RecentSearch[]) : [];
  } catch {
    return [];
  }
}
export async function addRecentSearch(entry: RecentSearch): Promise<void> {
  const term = entry.term.trim();
  if (!term) return;
  try {
    const list = await getRecentSearches();
    const deduped = [entry, ...list.filter((r) => !(r.term === term && r.mode === entry.mode))].slice(0, RECENT_MAX);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(deduped));
  } catch {
    /* best-effort */
  }
}
export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RECENT_KEY);
  } catch {
    /* best-effort */
  }
}

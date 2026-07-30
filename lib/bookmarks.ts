import { signMediaPaths } from '@/lib/media';
import { supabase } from '@/lib/supabase';

export type Collection = {
  id: string;
  name: string;
  item_count: number;
  cover_url: string | null; // signed for display
  created_at: string;
};

export type SavedPost = {
  id: string;
  thumbnail_url: string; // signed for display
  media_type: 'image' | 'video';
  saved_at: string;
};

// ---- reads ------------------------------------------------------------------
export async function getCollections(): Promise<Collection[]> {
  const { data, error } = await supabase.rpc('get_collections');
  if (error) throw error;
  const rows = (data ?? []) as Collection[];
  const covers = rows.map((r) => r.cover_url).filter((u): u is string => !!u);
  if (covers.length === 0) return rows;
  const signed = await signMediaPaths(covers);
  return rows.map((r) => ({ ...r, cover_url: r.cover_url ? (signed.get(r.cover_url) ?? r.cover_url) : null }));
}

/** Posts in a collection, or ALL saved posts when `collectionId` is omitted. */
export async function getBookmarks(collectionId?: string | null): Promise<SavedPost[]> {
  const { data, error } = await supabase.rpc('get_bookmarks', { _collection_id: collectionId ?? null });
  if (error) throw error;
  const rows = (data ?? []) as SavedPost[];
  if (rows.length === 0) return rows;
  const signed = await signMediaPaths(rows.map((r) => r.thumbnail_url));
  return rows.map((r) => ({ ...r, thumbnail_url: signed.get(r.thumbnail_url) ?? r.thumbnail_url }));
}

/** Whether a post is saved, and which collection it's in (null = unsorted). */
export async function getBookmarkState(
  postId: string,
): Promise<{ saved: boolean; collectionId: string | null }> {
  const { data, error } = await supabase.rpc('get_bookmark', { _post_id: postId });
  if (error) throw error;
  const rows = (data ?? []) as { collection_id: string | null }[];
  if (rows.length === 0) return { saved: false, collectionId: null };
  return { saved: true, collectionId: rows[0].collection_id };
}

// ---- mutations --------------------------------------------------------------
export async function createCollection(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_collection', { _name: name });
  if (error) throw error;
  return data as string;
}
export async function deleteCollection(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_collection', { _id: id });
  if (error) throw error;
}
export async function saveBookmark(postId: string, collectionId?: string | null): Promise<void> {
  const { error } = await supabase.rpc('save_bookmark', { _post_id: postId, _collection_id: collectionId ?? null });
  if (error) throw error;
}
export async function removeBookmark(postId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_bookmark', { _post_id: postId });
  if (error) throw error;
}

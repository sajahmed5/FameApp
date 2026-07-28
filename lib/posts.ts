import { signMediaPaths } from '@/lib/media';
import { supabase } from '@/lib/supabase';
import { findOrCreateTag } from '@/lib/tags';

export type MyPost = {
  id: string;
  thumbnail_url: string; // signed for display
  media_type: 'image' | 'video';
  moderation_status: 'approved' | 'flagged' | 'pending' | 'removed';
  visibility: 'public' | 'private';
  created_at: string;
};

export type EditablePost = {
  id: string;
  media_url: string; // signed for preview
  media_type: 'image' | 'video';
  caption: string;
  alt_text: string;
  visibility: 'public' | 'private';
  tags: { name: string; source: 'user' | 'vision' | 'geo' }[];
};

/** The signed-in user's own posts (all statuses/visibilities), newest first. */
export async function getMyPosts(): Promise<MyPost[]> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from('posts')
    .select('id, thumbnail_url, media_type, moderation_status, visibility, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as MyPost[];
  const signed = await signMediaPaths(rows.map((r) => r.thumbnail_url));
  return rows.map((r) => ({ ...r, thumbnail_url: signed.get(r.thumbnail_url) ?? r.thumbnail_url }));
}

/** Load a post the caller owns, with its tags, for editing. */
export async function getPostForEdit(id: string): Promise<EditablePost> {
  const { data, error } = await supabase
    .from('posts')
    .select(
      'id, media_url, media_type, caption, alt_text, visibility, post_tags(source, tags(name))',
    )
    .eq('id', id)
    .single();
  if (error) throw error;
  // Supabase types the to-one `tags` relationship loosely (object or array) — normalise.
  type TagRel = { name: string } | { name: string }[] | null;
  const row = data as unknown as {
    id: string;
    media_url: string;
    media_type: 'image' | 'video';
    caption: string | null;
    alt_text: string | null;
    visibility: 'public' | 'private';
    post_tags: { source: 'user' | 'vision' | 'geo'; tags: TagRel }[];
  };
  const signed = await signMediaPaths([row.media_url]);
  const tags = (row.post_tags ?? [])
    .map((pt) => {
      const t = Array.isArray(pt.tags) ? pt.tags[0] : pt.tags;
      return t?.name ? { name: t.name, source: pt.source } : null;
    })
    .filter((t): t is { name: string; source: 'user' | 'vision' | 'geo' } => t !== null);
  return {
    id: row.id,
    media_url: signed.get(row.media_url) ?? row.media_url,
    media_type: row.media_type,
    caption: row.caption ?? '',
    alt_text: row.alt_text ?? '',
    visibility: row.visibility,
    tags,
  };
}

export type UpdatePostInput = {
  caption: string;
  altText: string;
  visibility: 'public' | 'private';
  tags: { name: string; source: 'user' | 'vision' | 'geo' }[];
};

/**
 * Update caption / alt / visibility and reconcile tags. Visibility takes effect at the
 * DB immediately: get_deck/get_following_deck read `visibility` live, so a now-private
 * post drops out of other users' worldwide decks on their next fetch. (Media is not
 * editable — no media columns are touched.)
 */
export async function updatePost(id: string, input: UpdatePostInput): Promise<void> {
  const { error } = await supabase
    .from('posts')
    .update({
      caption: input.caption.trim() || null,
      alt_text: input.altText.trim() || null,
      visibility: input.visibility,
    })
    .eq('id', id);
  if (error) throw error;

  // Reconcile tags: resolve names → ids, then replace the post's tag set.
  const resolved = await Promise.all(
    input.tags.map(async (t) => ({ tag: await findOrCreateTag(t.name), source: t.source })),
  );
  const seen = new Set<string>();
  const rows = resolved
    .filter((r) => (seen.has(r.tag.id) ? false : (seen.add(r.tag.id), true)))
    .map((r) => ({ post_id: id, tag_id: r.tag.id, source: r.source }));

  const { error: delErr } = await supabase.from('post_tags').delete().eq('post_id', id);
  if (delErr) throw delErr;
  if (rows.length) {
    const { error: insErr } = await supabase.from('post_tags').insert(rows);
    if (insErr) throw insErr;
  }
}

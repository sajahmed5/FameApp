import { supabase } from '@/lib/supabase';

export type Tag = { id: string; name: string; usage_count?: number };

/** Normalise a typed tag the same way the DB check expects: trimmed, lowercase, collapsed. */
export function normaliseTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Search existing tags by prefix/substring for autocomplete. */
export async function searchTags(query: string, limit = 8): Promise<Tag[]> {
  const q = normaliseTag(query);
  if (!q) return [];
  const { data, error } = await supabase
    .from('tags')
    .select('id, name, usage_count')
    .ilike('name', `%${q}%`)
    .order('usage_count', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as Tag[];
}

/**
 * Find an existing tag by its normalised name, creating it only if none exists —
 * the same rule onboarding uses, so "Street Food" maps to an existing "street food"
 * instead of duplicating it. Returns the resolved tag.
 */
export async function findOrCreateTag(rawName: string): Promise<Tag> {
  const name = normaliseTag(rawName);
  if (!name) throw new Error('empty tag');

  const { data: existing, error: findError } = await supabase
    .from('tags')
    .select('id, name')
    .eq('name', name)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing as Tag;

  const { data: created, error: insertError } = await supabase
    .from('tags')
    .insert({ name })
    .select('id, name')
    .single();
  // Race: another insert won between our check and insert → fetch the winner.
  if (insertError) {
    if (insertError.code === '23505') {
      const { data } = await supabase.from('tags').select('id, name').eq('name', name).single();
      if (data) return data as Tag;
    }
    throw insertError;
  }
  return created as Tag;
}

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AuthScreen } from '@/components/ui/auth-screen';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/hooks/use-theme';
import type { Tag } from '@/types';

const MIN_TAGS = 3;
const MAX_TAG_LENGTH = 50;
const POPULAR_LIMIT = 30;
const SEARCH_DEBOUNCE_MS = 300;

/** Normalise a typed tag name the same way the DB check expects: trimmed + lowercase. */
function normaliseTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

export default function OnboardingTagsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuth();
  const uid = user?.id;

  const [popular, setPopular] = useState<Tag[]>([]);
  const [tagsById, setTagsById] = useState<Record<string, Tag>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<{ q: string; results: Tag[] } | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const mergeTags = useCallback((tags: Tag[]) => {
    setTagsById((prev) => {
      const next = { ...prev };
      for (const t of tags) next[t.id] = t;
      return next;
    });
  }, []);

  const loadInitial = useCallback(async () => {
    if (!uid) return;
    setInitialLoading(true);
    setLoadError(null);
    // Popular tags + any tags this user already selected (resume after a kill).
    const [popularRes, selectedRes] = await Promise.all([
      supabase
        .from('tags')
        .select('id, name, usage_count')
        .order('usage_count', { ascending: false })
        .limit(POPULAR_LIMIT),
      supabase.from('user_tags').select('tag_id').eq('user_id', uid),
    ]);

    if (popularRes.error || selectedRes.error) {
      setLoadError('Could not load tags. Check your connection and try again.');
      setInitialLoading(false);
      return;
    }

    const popularTags = (popularRes.data ?? []) as Tag[];
    const selected = (selectedRes.data ?? []).map((r) => r.tag_id as string);
    mergeTags(popularTags);
    setPopular(popularTags);
    setSelectedIds(selected);

    // Fetch names for any already-selected tags not in the popular list.
    const missing = selected.filter((id) => !popularTags.some((t) => t.id === id));
    if (missing.length) {
      const { data } = await supabase
        .from('tags')
        .select('id, name, usage_count')
        .in('id', missing);
      if (data) mergeTags(data as Tag[]);
    }
    setInitialLoading(false);
  }, [uid, mergeTags]);

  useEffect(() => {
    // Data loader on mount; sets loading state internally (not a derived-state effect).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInitial();
  }, [loadInitial]);

  // Debounced search against existing tags. Only the async result is stored; the empty
  // query is handled by derived state below, so no synchronous setState in the effect.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from('tags')
        .select('id, name, usage_count')
        .ilike('name', `%${q}%`)
        .order('usage_count', { ascending: false })
        .limit(POPULAR_LIMIT);
      if (cancelled) return;
      if (!error && data) {
        mergeTags(data as Tag[]);
        setSearchState({ q, results: data as Tag[] });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mergeTags]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const withBusy = useCallback(async (id: string, fn: () => Promise<void>) => {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await fn();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  async function addTag(tag: Tag) {
    if (!uid || selectedSet.has(tag.id)) return;
    setActionError(null);
    mergeTags([tag]);
    setSelectedIds((prev) => [...prev, tag.id]); // optimistic
    await withBusy(tag.id, async () => {
      const { error } = await supabase
        .from('user_tags')
        .insert({ user_id: uid, tag_id: tag.id, weight: 1.0 });
      if (error && error.code !== '23505') {
        setSelectedIds((prev) => prev.filter((x) => x !== tag.id)); // revert
        setActionError('Could not save that selection. Try again.');
      }
    });
  }

  async function removeTag(id: string) {
    if (!uid) return;
    setActionError(null);
    const prevSelected = selectedIds;
    setSelectedIds((prev) => prev.filter((x) => x !== id)); // optimistic
    await withBusy(id, async () => {
      const { error } = await supabase
        .from('user_tags')
        .delete()
        .eq('user_id', uid)
        .eq('tag_id', id);
      if (error) {
        setSelectedIds(prevSelected); // revert
        setActionError('Could not remove that selection. Try again.');
      }
    });
  }

  const normalised = normaliseTag(query);
  const createError =
    query.length > 0 && normalised.length === 0
      ? 'Tag name cannot be empty.'
      : normalised.length > MAX_TAG_LENGTH
        ? `Tags must be ${MAX_TAG_LENGTH} characters or fewer.`
        : null;

  const exactMatch = useMemo(
    () => Object.values(tagsById).find((t) => t.name === normalised),
    [tagsById, normalised],
  );
  const canCreate = normalised.length > 0 && !createError && !exactMatch;

  async function createTag() {
    if (!uid || !canCreate || creating) return;
    setCreating(true);
    setActionError(null);
    try {
      // Re-check against the DB after normalising so "Street Food" can't duplicate
      // an existing "street food".
      const { data: existing, error: findError } = await supabase
        .from('tags')
        .select('id, name, usage_count')
        .eq('name', normalised)
        .maybeSingle();
      if (findError) {
        setActionError('Could not create that tag. Try again.');
        return;
      }
      if (existing) {
        await addTag(existing as Tag);
        setQuery('');
        return;
      }
      const { data: created, error: insertError } = await supabase
        .from('tags')
        .insert({ name: normalised })
        .select('id, name, usage_count')
        .single();
      if (insertError || !created) {
        setActionError('Could not create that tag. Try again.');
        return;
      }
      await addTag(created as Tag);
      setQuery('');
    } finally {
      setCreating(false);
    }
  }

  const trimmedQuery = query.trim();
  const searchResults =
    trimmedQuery && searchState?.q === trimmedQuery ? searchState.results : null;
  const searching = trimmedQuery.length > 0 && searchState?.q !== trimmedQuery;
  const availableSource = trimmedQuery ? (searchResults ?? []) : popular;
  const availableTags = availableSource.filter((t) => !selectedSet.has(t.id));
  const selectedTags = selectedIds.map((id) => tagsById[id]).filter((t): t is Tag => !!t);
  const enough = selectedIds.length >= MIN_TAGS;

  return (
    <AuthScreen
      brand
      title="Pick a few interests"
      subtitle="Tap at least 3 tags. We use them to build your feed and suggest people to follow."
      footer={
        <Button
          title={enough ? 'Continue' : `Select ${MIN_TAGS - selectedIds.length} more`}
          onPress={() => {
            track('onboarding_tags_complete', { tag_count: selectedIds.length });
            router.push('/(onboarding)/accounts');
          }}
          disabled={!enough}
        />
      }>
      <ProgressRow count={selectedIds.length} min={MIN_TAGS} />

      {actionError ? <FormMessage tone="error">{actionError}</FormMessage> : null}

      <TextField
        label="Search or create a tag"
        value={query}
        onChangeText={setQuery}
        error={createError}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="e.g. street food"
        maxLength={MAX_TAG_LENGTH + 5}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (canCreate) createTag();
        }}
      />

      {selectedTags.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Selected
          </ThemedText>
          <View style={styles.chips}>
            {selectedTags.map((t) => (
              <Chip
                key={t.id}
                label={t.name}
                selected
                trailingIcon="close"
                disabled={busyIds.has(t.id)}
                onPress={() => removeTag(t.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {initialLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : loadError ? (
        <View style={styles.section}>
          <FormMessage tone="error">{loadError}</FormMessage>
          <Button title="Retry" variant="secondary" onPress={loadInitial} />
        </View>
      ) : (
        <View style={styles.section}>
          {canCreate ? (
            <Chip
              label={`Create "${normalised}"`}
              leadingIcon="add"
              disabled={creating}
              onPress={createTag}
            />
          ) : null}

          {searching ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.textSecondary} />
            </View>
          ) : availableTags.length > 0 ? (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {trimmedQuery ? 'Matching tags' : 'Popular tags'}
              </ThemedText>
              <View style={styles.chips}>
                {availableTags.map((t) => (
                  <Chip
                    key={t.id}
                    label={t.name}
                    disabled={busyIds.has(t.id)}
                    onPress={() => addTag(t)}
                  />
                ))}
              </View>
            </>
          ) : !canCreate ? (
            <ThemedText type="small" themeColor="textSecondary">
              {trimmedQuery
                ? 'No matching tags. Adjust your search or create a new one above.'
                : 'No popular tags yet — type above to create your own.'}
            </ThemedText>
          ) : null}
        </View>
      )}
    </AuthScreen>
  );
}

function ProgressRow({ count, min }: { count: number; min: number }) {
  const theme = useTheme();
  const done = Math.min(count, min);
  return (
    <View style={styles.progress}>
      <View style={styles.dots}>
        {Array.from({ length: min }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i < done ? theme.success : theme.backgroundSelected },
            ]}
          />
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {count} selected{count < min ? ` · ${min - count} to go` : ''}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  center: { paddingVertical: 24, alignItems: 'center' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 24, height: 4, borderRadius: 2 },
});

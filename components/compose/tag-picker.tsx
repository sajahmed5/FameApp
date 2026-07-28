import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui/chip';
import { TextField } from '@/components/ui/text-field';
import { useTheme } from '@/hooks/use-theme';
import { normaliseTag, searchTags, type Tag } from '@/lib/tags';

export type SelectedTag = { name: string; source: 'user' | 'vision' | 'geo' };

type Props = {
  visionSuggestions: string[];
  geoSuggestions: string[];
  analysing: boolean; // pipeline still running → suggestions not in yet
  selected: SelectedTag[];
  onChange: (next: SelectedTag[]) => void;
};

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Presents vision-suggested, geo-suggested, and user-typed tags together as tappable
 * chips. Nothing is pre-selected — a tag is only applied when the user taps it. Typed
 * tags autocomplete against existing tags and are normalised (lowercase/trim) so they
 * map to an existing tag before creating a new one (creation happens at post time).
 */
export function TagPicker({
  visionSuggestions,
  geoSuggestions,
  analysing,
  selected,
  onChange,
}: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  // Store the query alongside its results so we only show matches for the current input
  // (and never need to clear state synchronously when the query empties).
  const [search, setSearch] = useState<{ q: string; rows: Tag[] }>({ q: '', rows: [] });

  const has = (name: string) => selected.some((t) => t.name === name);
  const add = (name: string, source: SelectedTag['source']) => {
    const n = normaliseTag(name);
    if (!n || has(n)) return;
    onChange([...selected, { name: n, source }]);
  };
  const remove = (name: string) => onChange(selected.filter((t) => t.name !== name));
  const toggle = (name: string, source: SelectedTag['source']) =>
    has(name) ? remove(name) : add(name, source);

  // Debounced autocomplete against existing tags. Only the async result is stored;
  // the empty query is handled by derived state below (no synchronous setState here).
  useEffect(() => {
    const q = normaliseTag(query);
    if (!q) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const rows = await searchTags(q);
      if (!cancelled) setSearch({ q, rows });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const normalisedQuery = normaliseTag(query);
  const results = search.q === normalisedQuery ? search.rows : [];
  const exactExists = results.some((r) => r.name === normalisedQuery);

  function commitTyped() {
    if (!normalisedQuery) return;
    add(normalisedQuery, 'user');
    setQuery('');
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="smallBold">Tags</ThemedText>
        <ThemedText type="small" themeColor={selected.length ? 'textSecondary' : 'danger'}>
          {selected.length ? `${selected.length} added` : 'Add at least one'}
        </ThemedText>
      </View>

      {/* Selected tags */}
      {selected.length > 0 ? (
        <View style={styles.wrap}>
          {selected.map((t) => (
            <Chip
              key={t.name}
              label={t.name}
              selected
              leadingIcon={
                t.source === 'vision' ? 'sparkles' : t.source === 'geo' ? 'location' : undefined
              }
              trailingIcon="close"
              onPress={() => remove(t.name)}
            />
          ))}
        </View>
      ) : null}

      {/* Typed tag + autocomplete */}
      <TextField
        label=""
        placeholder="Add a tag"
        autoCapitalize="none"
        autoCorrect={false}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={commitTyped}
        returnKeyType="done"
      />
      {results.length > 0 ? (
        <View style={styles.wrap}>
          {results.map((r) => (
            <Chip
              key={r.id}
              label={r.name}
              selected={has(r.name)}
              onPress={() => toggle(r.name, 'user')}
            />
          ))}
        </View>
      ) : null}
      {normalisedQuery && !exactExists ? (
        <Chip label={`Create "${normalisedQuery}"`} leadingIcon="add" onPress={commitTyped} />
      ) : null}

      {/* Auto-suggestions, visually distinguished from typed tags. */}
      {analysing ? (
        <ThemedText type="small" themeColor="textSecondary">
          Analysing your media for suggestions…
        </ThemedText>
      ) : (
        <>
          {visionSuggestions.length > 0 ? (
            <SuggestionGroup
              icon="sparkles-outline"
              title="Suggested from your photo"
              items={visionSuggestions}
              color={theme.textSecondary}
              isSelected={has}
              onToggle={(n) => toggle(n, 'vision')}
            />
          ) : null}
          {geoSuggestions.length > 0 ? (
            <SuggestionGroup
              icon="location-outline"
              title="Suggested from location"
              items={geoSuggestions}
              color={theme.textSecondary}
              isSelected={has}
              onToggle={(n) => toggle(n, 'geo')}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

function SuggestionGroup({
  icon,
  title,
  items,
  color,
  isSelected,
  onToggle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  items: string[];
  color: string;
  isSelected: (n: string) => boolean;
  onToggle: (n: string) => void;
}) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <Ionicons name={icon} size={14} color={color} />
        <ThemedText type="small" themeColor="textSecondary">
          {title}
        </ThemedText>
      </View>
      <View style={styles.wrap}>
        {items.map((name) => (
          <Chip
            key={name}
            label={name}
            leadingIcon={icon}
            selected={isSelected(name)}
            onPress={() => onToggle(name)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  group: { gap: 8 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});

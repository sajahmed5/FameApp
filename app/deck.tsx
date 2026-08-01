import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DeckView } from '@/components/deck/deck-view';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { makeSearchDeckFetcher, type SearchMode } from '@/lib/search';

/**
 * A swipe deck seeded from a search result set (spec §12: "tapping opens a deck
 * seeded with those results so the swipe mechanic still applies"). Reuses the
 * shared DeckView with a search-backed, paginated fetcher that starts at the
 * tapped item.
 */
export default function SearchDeckScreen() {
  const { mode, q, tag, start } = useLocalSearchParams<{ mode?: string; q?: string; tag?: string; start?: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const fetcher = useMemo(
    () =>
      makeSearchDeckFetcher({
        mode: (mode as SearchMode) ?? 'worldwide',
        q,
        tag,
        start: Number(start ?? 0),
      }),
    [mode, q, tag, start],
  );

  const title = tag ? `#${tag}` : q ? `“${q}”` : 'Results';

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </Pressable>
        <ThemedText type="subtitle" numberOfLines={1} style={{ flex: 1 }}>
          {title}
        </ThemedText>
      </View>
      <DeckView fetchBatch={fetcher} hasTabBar={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
});

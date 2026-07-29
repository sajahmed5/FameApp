import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { nearbyPlaces, type NearbyPlace } from '@/lib/location';

function distanceLabel(m: number | null): string | null {
  if (m == null) return null;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * Instagram-style location picker. Opens over the compose screen: shows nearby places by
 * default and text-searches (shop, restaurant, city, country) as you type, all biased to
 * the origin. Selecting one returns it to the caller, which stores only a coarse cell.
 */
export function LocationPicker({
  visible,
  origin,
  onClose,
  onSelect,
}: {
  visible: boolean;
  origin: { lat: number; lon: number } | null;
  onClose: () => void;
  onSelect: (place: NearbyPlace) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NearbyPlace[] | null>(null); // null = loading

  // Fetch nearby on open, and re-query (debounced) as the search text changes.
  useEffect(() => {
    if (!visible || !origin) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to the loading state before the (debounced) fetch
    setResults(null);
    const q = query.trim();
    const t = setTimeout(
      () => {
        void nearbyPlaces(origin.lat, origin.lon, q || undefined).then((r) => {
          if (active) setResults(r);
        });
      },
      q ? 350 : 0,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [visible, origin, query]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={styles.fill}>
        <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: theme.border }]}>
          <ThemedText type="subtitle">Add location</ThemedText>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={theme.text} />
          </Pressable>
        </View>

        <View style={[styles.searchWrap, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <Ionicons name="search" size={16} color={theme.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search places, cities, countries…"
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
            autoCorrect={false}
            returnKeyType="search"
            autoFocus={false}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear">
              <Ionicons name="close-circle" size={16} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {results === null ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : results.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="location-outline" size={36} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
              {query ? `No places found for “${query.trim()}”.` : 'No places nearby.'}
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(p, i) => `${p.name}-${p.lat}-${p.lon}-${i}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const dist = distanceLabel(item.distanceM);
              return (
                <Pressable
                  onPress={() => onSelect(item)}
                  style={({ pressed }) => [styles.row, { borderBottomColor: theme.border }, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button">
                  <Ionicons name="location-outline" size={18} color={theme.textSecondary} />
                  <View style={styles.rowText}>
                    <ThemedText type="default" numberOfLines={1}>
                      {item.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {[dist, item.address].filter(Boolean).join(' · ') || 'Tap to tag'}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 16, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontSize: 16, padding: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
});

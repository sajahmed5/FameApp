import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';

/** Skeleton card shown while the first batch loads — not a bare spinner. */
export function DeckSkeleton() {
  const theme = useTheme();
  return (
    <View style={styles.fill}>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.shimmerTopRight, { backgroundColor: theme.backgroundSelected }]} />
        <View style={styles.skeletonBottom}>
          <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]} />
          <View style={styles.skeletonLines}>
            <View
              style={[styles.line, styles.lineShort, { backgroundColor: theme.backgroundSelected }]}
            />
            <View style={[styles.line, { backgroundColor: theme.backgroundSelected }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

/** Deck exhausted — a real empty state with a way to broaden. */
export function DeckExhausted({ onRefresh }: { onRefresh: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.centered}>
      <Ionicons name="sparkles-outline" size={44} color={theme.textSecondary} />
      <ThemedText type="subtitle" style={styles.centerText}>
        You&apos;re all caught up
      </ThemedText>
      <ThemedText type="default" themeColor="textSecondary" style={styles.centerText}>
        You&apos;ve seen everything matching your interests for now. Add more interests to widen
        your feed, or check back soon.
      </ThemedText>
      <Button title="Check for more" onPress={onRefresh} />
    </View>
  );
}

/** Network/query error with a retry that preserves any queued swipes. */
export function DeckError({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.centered}>
      <Ionicons name="cloud-offline-outline" size={44} color={theme.textSecondary} />
      <ThemedText type="subtitle" style={styles.centerText}>
        Couldn&apos;t load your feed
      </ThemedText>
      <ThemedText type="default" themeColor="textSecondary" style={styles.centerText}>
        Check your connection and try again. Any swipes you&apos;ve made are saved and will sync.
      </ThemedText>
      <Button title="Retry" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  card: { flex: 1, borderRadius: 20, overflow: 'hidden' },
  shimmerTopRight: {
    position: 'absolute',
    top: 16,
    right: 12,
    width: 34,
    height: 120,
    borderRadius: 12,
  },
  skeletonBottom: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  skeletonLines: { flex: 1, gap: 8 },
  line: { height: 12, borderRadius: 6 },
  lineShort: { width: '45%' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 32,
  },
  centerText: { textAlign: 'center' },
});

import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DeckError, DeckExhausted, DeckSkeleton } from '@/components/deck/deck-states';
import { SwipeDeck } from '@/components/deck/swipe-deck';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import type { DeckCard } from '@/lib/deck';
import { shareCard } from '@/lib/share';
import { useDeck } from '@/lib/use-deck';

export default function HomeScreen() {
  const { cards, status, canUndo, pendingWrites, swipe, undo, retry } = useDeck();
  const insets = useSafeAreaInsets();

  const onShare = useCallback((card: DeckCard) => {
    void shareCard(card);
  }, []);

  let body: React.ReactNode;
  if (cards.length > 0) {
    body = (
      <View style={styles.deckArea}>
        <SwipeDeck cards={cards} onSwipe={swipe} onShare={onShare} />
        <View style={[styles.controls, { bottom: insets.bottom + 12 }]}>
          <UndoButton disabled={!canUndo} onPress={undo} />
        </View>
        {pendingWrites > 0 ? <PendingPill count={pendingWrites} top={insets.top + 8} /> : null}
      </View>
    );
  } else if (status === 'error') {
    body = <DeckError onRetry={retry} />;
  } else if (status === 'exhausted') {
    body = <DeckExhausted onRefresh={retry} />;
  } else {
    // loading, or briefly empty while the next batch loads
    body = <DeckSkeleton />;
  }

  return <ThemedView style={styles.container}>{body}</ThemedView>;
}

function UndoButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Undo last swipe"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.undo,
        {
          backgroundColor: theme.background,
          borderColor: theme.border,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
      ]}>
      <Ionicons name="arrow-undo" size={24} color={theme.text} />
    </Pressable>
  );
}

function PendingPill({ count, top }: { count: number; top: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.pending, { top, backgroundColor: theme.backgroundElement }]}>
      <Ionicons name="cloud-upload-outline" size={14} color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary">
        {count} pending
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  deckArea: { flex: 1, padding: 10 },
  controls: {
    position: 'absolute',
    left: 20,
    // Kept to the left so it never collides with the centre Camera tab button.
    alignItems: 'flex-start',
    pointerEvents: 'box-none',
  },
  undo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0px 3px 8px rgba(0,0,0,0.15)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
      },
    }),
  },
  pending: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
});

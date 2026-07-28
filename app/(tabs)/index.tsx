import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommentSheet } from '@/components/comments/comment-sheet';
import { DeckError, DeckExhausted, DeckSkeleton } from '@/components/deck/deck-states';
import { SwipeDeck } from '@/components/deck/swipe-deck';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import type { DeckCard } from '@/lib/deck';
import { shareCard } from '@/lib/share';
import { useDeck } from '@/lib/use-deck';

export default function HomeScreen() {
  const { cards, status, canUndo, pendingWrites, swipe, undo, retry, adjustCommentCount } =
    useDeck();
  const insets = useSafeAreaInsets();

  const [commentsCard, setCommentsCard] = useState<DeckCard | null>(null);

  const onShare = useCallback((card: DeckCard) => {
    void shareCard(card);
  }, []);
  const onOpenComments = useCallback((card: DeckCard) => setCommentsCard(card), []);

  let body: React.ReactNode;
  if (cards.length > 0) {
    body = (
      <View style={styles.deckArea}>
        <SwipeDeck
          cards={cards}
          onSwipe={swipe}
          onShare={onShare}
          onOpenComments={onOpenComments}
          canUndo={canUndo}
          onUndo={undo}
        />
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

  return (
    <ThemedView style={styles.container}>
      {body}
      {commentsCard ? (
        <CommentSheet
          postId={commentsCard.id}
          onClose={() => setCommentsCard(null)}
          onCountDelta={(delta) => adjustCommentCount(commentsCard.id, delta)}
        />
      ) : null}
    </ThemedView>
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

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommentSheet } from '@/components/comments/comment-sheet';
import { DeckError, DeckExhausted, DeckSkeleton } from '@/components/deck/deck-states';
import { SwipeDeck } from '@/components/deck/swipe-deck';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { DeckCard, FetchBatch } from '@/lib/deck';
import { shareCard } from '@/lib/share';
import { useDeck } from '@/lib/use-deck';

/** Context handed to a custom empty-state renderer. */
export type DeckEmptyContext = {
  /** Reload the deck from scratch (e.g. after the user follows someone). */
  retry: () => void;
};

type DeckViewProps = {
  /** The candidate-pool fetcher — this is the only thing that differs between feeds. */
  fetchBatch: FetchBatch;
  /** Optional content pinned above the deck (e.g. the Following stories rail). */
  header?: React.ReactNode;
  /**
   * Custom empty state, shown when the deck has no cards to display (status `exhausted`).
   * Following overrides this to distinguish "you follow nobody" / "nobody has posted" /
   * "you're caught up". Defaults to the generic "all caught up" card.
   */
  renderEmpty?: (ctx: DeckEmptyContext) => React.ReactNode;
};

/**
 * Shared deck surface for both the Home (worldwide) and Following feeds. Owns the swipe
 * deck, the offline-aware pending pill, the comment sheet, and the loading/error/empty
 * state machine. The two tabs differ only by the `fetchBatch` they pass and the optional
 * `header` / `renderEmpty` slots — there is a single deck implementation.
 */
export function DeckView({ fetchBatch, header, renderEmpty }: DeckViewProps) {
  const { cards, status, canUndo, pendingWrites, swipe, undo, retry, adjustCommentCount } =
    useDeck(fetchBatch);
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
    body = renderEmpty ? <>{renderEmpty({ retry })}</> : <DeckExhausted onRefresh={retry} />;
  } else {
    // loading, or briefly empty while the next batch loads
    body = <DeckSkeleton />;
  }

  return (
    <View style={styles.container}>
      {header}
      <View style={styles.body}>{body}</View>
      {commentsCard ? (
        <CommentSheet
          postId={commentsCard.id}
          onClose={() => setCommentsCard(null)}
          onCountDelta={(delta) => adjustCommentCount(commentsCard.id, delta)}
        />
      ) : null}
    </View>
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
  body: { flex: 1 },
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

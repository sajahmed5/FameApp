import { DeckView } from '@/components/deck/deck-view';
import { FollowingEmpty } from '@/components/deck/following-empty';
import { StoriesRail } from '@/components/deck/stories-rail';
import { ErrorBoundary } from '@/components/error-boundary';
import { ThemedView } from '@/components/themed-view';
import { fetchFollowingDeck } from '@/lib/deck';

/**
 * Following — the unranked, newest-first feed of accepted-follow accounts. Same deck as
 * Home (shared `DeckView`), fed by a different candidate pool. Adds the stories rail on top
 * and Following-specific empty states. To drop stories, remove the `<StoriesRail />` header.
 */
export default function FollowingScreen() {
  return (
    <ThemedView style={{ flex: 1 }}>
      <ErrorBoundary label="The feed">
        <DeckView
          fetchBatch={fetchFollowingDeck}
          header={<StoriesRail />}
          renderEmpty={({ retry }) => <FollowingEmpty onReload={retry} />}
        />
      </ErrorBoundary>
    </ThemedView>
  );
}

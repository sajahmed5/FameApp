import { ErrorBoundary } from '@/components/error-boundary';
import { ThemedView } from '@/components/themed-view';
import { DeckView } from '@/components/deck/deck-view';
import { fetchDeck } from '@/lib/deck';

/** Home — the worldwide, ranked feed. Just the shared deck fed by the worldwide pool.
 * The phixr lockup lives in the tab's header (see (tabs)/_layout.tsx). */
export default function HomeScreen() {
  return (
    <ThemedView style={{ flex: 1 }}>
      <ErrorBoundary label="The feed">
        <DeckView fetchBatch={fetchDeck} />
      </ErrorBoundary>
    </ThemedView>
  );
}

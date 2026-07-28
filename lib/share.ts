import { Platform, Share } from 'react-native';

import type { DeckCard } from '@/lib/deck';
import { supabase } from '@/lib/supabase';

// Placeholder universal-link host. Swap for the real domain once web/deep links exist.
const POST_LINK_BASE = 'https://fame.app/p';

/**
 * Share a post via the native share sheet (a link to the post).
 *
 * V2 EXTENSION POINT — in-app friend sharing: before falling back to the OS sheet,
 * present an in-app friend picker here and, on selection, send the post through the
 * (future) messaging layer instead of / in addition to the native share.
 */
export async function shareCard(card: DeckCard): Promise<void> {
  const url = `${POST_LINK_BASE}/${card.id}`;
  const text = card.caption ? `${card.caption} — on Fame` : 'Check this out on Fame';

  try {
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav?.share) {
        await nav.share({ title: 'Fame', text, url });
        void recordShare(card.id);
      }
      // else: no web share support — the in-app picker (above) will cover this in V2.
      return;
    }
    const result = await Share.share({ message: `${text} ${url}`, url });
    // Only count an actual share, not a dismissal (aggregate count — no viewer identity).
    if (result.action === Share.sharedAction) void recordShare(card.id);
  } catch {
    // User dismissed the sheet, or share is unavailable — nothing to do.
  }
}

async function recordShare(postId: string): Promise<void> {
  await supabase.rpc('record_share', { _post_id: postId }).then(undefined, () => {});
}

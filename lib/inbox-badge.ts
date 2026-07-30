import { useEffect, useSyncExternalStore } from 'react';

import { getConversations, subscribeToInbox } from '@/lib/messages';

/**
 * Live unread-messages badge for the Messages tab icon. The count is "new since you last
 * opened the inbox": it reflects unread conversations, but opening the Messages tab clears
 * it (markInboxSeen) even if the messages stay unread — and it reappears when a new message
 * arrives over realtime. Requests are excluded (they have their own count).
 */
let value = 0;
let dismissed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function report(unread: number) {
  const next = dismissed ? 0 : unread;
  if (next !== value) {
    value = next;
    emit();
  }
}

/** Called when the user opens the Messages tab — clears the badge until new activity. */
export function markInboxSeen() {
  dismissed = true;
  if (value !== 0) {
    value = 0;
    emit();
  }
}

/** Badge value for the tab (0 = hidden). */
export function useInboxBadge(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => value,
    () => value,
  );
}

/** Mount once (in the tabs layout): keeps the badge synced to unread convos + realtime. */
export function useInboxBadgeUpdater() {
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const convos = await getConversations();
        if (active) report(convos.filter((c) => c.unread && !c.is_request).length);
      } catch {
        /* ignore — keep the last known count */
      }
    };
    void refresh();
    const unsub = subscribeToInbox(() => {
      dismissed = false; // a new message re-arms the badge
      void refresh();
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);
}

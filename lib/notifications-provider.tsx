import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/lib/auth-context';
import {
  getUnreadCount,
  markRead,
  registerPushToken,
  type NotificationType,
} from '@/lib/notifications';

// Foreground display behaviour (must be set once, before any notification arrives).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

type Ctx = { unread: number; refreshUnread: () => Promise<void>; clearAll: () => Promise<void> };
const NotificationsContext = createContext<Ctx>({
  unread: 0,
  refreshUnread: async () => {},
  clearAll: async () => {},
});

/** Deep-link a notification to the right screen from its data payload. */
function route(
  data: { type?: NotificationType; post_id?: string | null; actor?: string | null } | undefined,
) {
  const type = data?.type;
  if (!type) return router.push('/notifications');
  if (type === 'follow_request') return router.push('/profile/requests');
  if ((type === 'new_follower' || type === 'follow_accepted') && data?.actor)
    return router.push(`/u/${data.actor}`);
  if (type === 'reach_milestone') return router.push('/analytics');
  if (type === 'moderation' && data?.post_id) return router.push(`/post/${data.post_id}/edit`);
  if ((type === 'comment' || type === 'reply' || type === 'comment_reaction') && data?.post_id)
    return router.push(`/post/${data.post_id}`);
  return router.push('/notifications');
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [unread, setUnread] = useState(0);
  const registered = useRef(false);

  const refreshUnread = useCallback(async () => {
    const n = await getUnreadCount();
    setUnread(n);
    await Notifications.setBadgeCountAsync(n).catch(() => {});
  }, []);

  const clearAll = useCallback(async () => {
    await markRead();
    await refreshUnread();
  }, [refreshUnread]);

  // Register the push token AFTER onboarding — status 'ready' means verified +
  // profile + onboarding complete. Runs once per session.
  useEffect(() => {
    if (status === 'ready' && !registered.current) {
      registered.current = true;
      void registerPushToken();
      void refreshUnread();
    }
    if (status === 'signedOut') {
      registered.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset badge on sign-out
      setUnread(0);
    }
  }, [status, refreshUnread]);

  // Foreground pushes → keep the badge fresh.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => void refreshUnread());
    return () => sub.remove();
  }, [refreshUnread]);

  // Taps on a notification → deep link. Also handle a cold start from a tap.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      route(resp.notification.request.content.data as never);
    });
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) route(resp.notification.request.content.data as never);
    });
    return () => sub.remove();
  }, []);

  const value = useMemo<Ctx>(
    () => ({ unread, refreshUnread, clearAll }),
    [unread, refreshUnread, clearAll],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): Ctx {
  return useContext(NotificationsContext);
}

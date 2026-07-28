import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export type NotificationType =
  | 'new_follower'
  | 'follow_request'
  | 'follow_accepted'
  | 'comment'
  | 'reply'
  | 'comment_reaction'
  | 'reach_milestone'
  | 'moderation';

export type InboxNotification = {
  id: string;
  type: NotificationType;
  count: number;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  actor_handle: string | null;
  actor_display_name: string | null;
  actor_avatar_url: string | null;
  post_id: string | null;
  post_thumbnail: string | null;
  comment_id: string | null;
};

export type RegisterResult = 'registered' | 'denied' | 'unsupported' | 'unavailable';

/**
 * Register this device for push. Call AFTER onboarding (not signup) — asking before
 * the user has seen value gets it denied. Fails soft: a denied permission or a missing
 * EAS project never throws or breaks the app; we just don't register a token.
 */
export async function registerPushToken(): Promise<RegisterResult> {
  if (!Device.isDevice) return 'unsupported'; // push doesn't work on simulators
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return 'denied';

  const projectId =
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
    Constants.easConfig?.projectId;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return 'unavailable';
    await supabase.from('push_tokens').upsert({
      token,
      user_id: u.user.id,
      platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
      updated_at: new Date().toISOString(),
    });
    return 'registered';
  } catch {
    // No EAS project configured, or Expo push service unreachable — non-fatal.
    return 'unavailable';
  }
}

/** Remove this device's token (on sign-out) so a signed-out device stops receiving pushes. */
export async function unregisterPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const projectId =
      (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
      Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await supabase.from('push_tokens').delete().eq('token', token);
  } catch {
    // best effort
  }
}

export async function getNotifications(before?: string): Promise<InboxNotification[]> {
  const { data, error } = await supabase.rpc('get_notifications', {
    _limit: 40,
    _before: before ?? null,
  });
  if (error) throw error;
  return (data ?? []) as InboxNotification[];
}

export async function getUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc('unread_notification_count');
  if (error) return 0;
  return Number(data ?? 0);
}

export async function markRead(ids?: string[]): Promise<void> {
  await supabase.rpc('mark_notifications_read', { _ids: ids ?? null });
}

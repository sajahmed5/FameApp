import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { getNotifications, type InboxNotification } from '@/lib/notifications';
import { signMediaPaths } from '@/lib/media';
import { useNotifications } from '@/lib/notifications-provider';
import { formatRelative } from '@/lib/relative-time';
import { useRefresh } from '@/lib/use-refresh';

export default function NotificationsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { clearAll, refreshUnread } = useNotifications();
  const [rows, setRows] = useState<InboxNotification[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const list = await getNotifications();
      // sign post thumbnails (private media bucket)
      const signed = await signMediaPaths(
        list.map((n) => n.post_thumbnail).filter(Boolean) as string[],
      );
      setRows(
        list.map((n) => ({
          ...n,
          post_thumbnail: n.post_thumbnail
            ? (signed.get(n.post_thumbnail) ?? n.post_thumbnail)
            : null,
        })),
      );
    } catch {
      setError(true);
    }
  }, []);

  const refresh = useRefresh(load);

  // Load + mark everything read when the inbox opens (badge clears on read).
  useFocusEffect(
    useCallback(() => {
      void load();
      void clearAll().then(refreshUnread);
    }, [load, clearAll, refreshUnread]),
  );

  function open(n: InboxNotification) {
    if (n.type === 'follow_request') return router.push('/profile/requests');
    if ((n.type === 'new_follower' || n.type === 'follow_accepted') && n.actor_handle)
      return router.push(`/u/${n.actor_handle}`);
    if (n.type === 'reach_milestone') return router.push('/analytics');
    if (n.type === 'moderation') {
      const status = String(n.payload.status ?? '');
      const appealable = n.payload.appealable === true || status === 'removed' || status === 'flagged';
      const targetType = (n.payload.target_type as string) ?? (n.post_id ? 'post' : n.comment_id ? 'comment' : 'account');
      const targetId = (n.payload.target_id as string) ?? n.post_id ?? n.comment_id ?? undefined;
      if (appealable && (targetId || targetType === 'account')) {
        return router.push({
          pathname: '/appeal',
          params: { targetType, ...(targetId ? { targetId } : {}), reason: String(n.payload.reason ?? '') },
        });
      }
      if (n.post_id) return router.push(`/post/${n.post_id}/edit`);
      return;
    }
    if ((n.type === 'comment' || n.type === 'reply' || n.type === 'comment_reaction') && n.post_id)
      return router.push(`/post/${n.post_id}`);
  }

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: 'Notifications' }} />
      {error ? (
        <View style={styles.center}>
          <ThemedText type="small" themeColor="textSecondary">
            Couldn&apos;t load notifications.
          </ThemedText>
          <Button title="Retry" variant="secondary" onPress={load} />
        </View>
      ) : rows === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="notifications-outline" size={40} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary">
            No notifications yet.
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => <Row n={item} onPress={() => open(item)} />}
          refreshControl={<RefreshControl {...refresh} tintColor={theme.textSecondary} />}
        />
      )}
    </ThemedView>
  );
}

function Row({ n, onPress }: { n: InboxNotification; onPress: () => void }) {
  const theme = useTheme();
  const unread = !n.read_at;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: unread ? theme.backgroundElement : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      {leading(n, theme)}
      <View style={styles.body}>
        <ThemedText type="small" numberOfLines={2}>
          {n.actor_handle ? <ThemedText type="smallBold">@{n.actor_handle} </ThemedText> : null}
          {message(n)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatRelative(n.created_at)}
        </ThemedText>
      </View>
      {n.post_thumbnail ? (
        <Image source={{ uri: n.post_thumbnail }} style={styles.thumb} contentFit="cover" />
      ) : null}
    </Pressable>
  );
}

function leading(n: InboxNotification, theme: ReturnType<typeof useTheme>) {
  if (n.type === 'reach_milestone') return <Badge icon="rocket" bg="#2E7D46" />;
  if (n.type === 'moderation') return <Badge icon="shield-checkmark" bg={theme.textSecondary} />;
  if (n.actor_avatar_url)
    return <Image source={{ uri: n.actor_avatar_url }} style={styles.avatar} contentFit="cover" />;
  return (
    <View
      style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold">
        {(n.actor_display_name ?? '?').slice(0, 1).toUpperCase()}
      </ThemedText>
    </View>
  );
}
function Badge({ icon, bg }: { icon: keyof typeof Ionicons.glyphMap; bg: string }) {
  return (
    <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={20} color="#fff" />
    </View>
  );
}

function message(n: InboxNotification): string {
  switch (n.type) {
    case 'new_follower':
      return 'started following you';
    case 'follow_request':
      return 'requested to follow you';
    case 'follow_accepted':
      return 'accepted your follow request';
    case 'comment':
      return n.count > 1
        ? `and ${n.count - 1} others commented on your post`
        : 'commented on your post';
    case 'reply':
      return n.count > 1
        ? `and ${n.count - 1} others replied to your comment`
        : 'replied to your comment';
    case 'comment_reaction':
      return `reacted ${n.payload.emoji ?? ''} to your comment`;
    case 'reach_milestone':
      return `Your post reached ${Number(n.payload.milestone ?? 0).toLocaleString()}+ people 🎉`;
    case 'moderation':
      return n.payload.status === 'approved'
        ? 'Your post is live'
        : n.payload.status === 'flagged'
          ? 'Your post is under review'
          : n.payload.status === 'removed'
            ? 'A post was removed for breaking guidelines'
            : 'Post update';
    default:
      return '';
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  thumb: { width: 44, height: 44, borderRadius: 6, backgroundColor: '#111' },
});

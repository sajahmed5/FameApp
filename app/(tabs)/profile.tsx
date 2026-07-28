import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { PostGrid } from '@/components/profile/post-grid';
import { ProfileHeader } from '@/components/profile/profile-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import {
  getPendingRequestCount,
  getProfileOverview,
  getProfilePosts,
  type GridPost,
  type ProfileOverview,
} from '@/lib/profile';

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile: authProfile } = useAuth();
  const handle = authProfile?.handle;

  const [overview, setOverview] = useState<ProfileOverview | null>(null);
  const [posts, setPosts] = useState<GridPost[] | null>(null);
  const [gridStatus, setGridStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [requestCount, setRequestCount] = useState(0);
  const [headError, setHeadError] = useState(false);

  const load = useCallback(async () => {
    if (!handle) return;
    setHeadError(false);
    try {
      const ov = await getProfileOverview(handle);
      setOverview(ov);
      if (ov) {
        setGridStatus('loading');
        try {
          setPosts(await getProfilePosts(ov.id));
          setGridStatus('ready');
        } catch {
          setGridStatus('error');
        }
      }
    } catch {
      setHeadError(true);
    }
    setRequestCount(await getPendingRequestCount());
  }, [handle]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!overview) {
    return (
      <ThemedView style={styles.center}>
        {headError ? (
          <ThemedText type="small" themeColor="textSecondary">
            Couldn&apos;t load your profile.
          </ThemedText>
        ) : (
          <ActivityIndicator color={theme.textSecondary} />
        )}
      </ThemedView>
    );
  }

  const goConnections = (type: 'followers' | 'following') =>
    router.push({
      pathname: '/connections',
      params: { userId: overview.id, type, title: overview.handle },
    });

  const header = (
    <ProfileHeader
      profile={overview}
      onPressFollowers={() => goConnections('followers')}
      onPressFollowing={() => goConnections('following')}
      action={
        <View style={styles.actions}>
          <ActionButton
            icon="create-outline"
            label="Edit profile"
            onPress={() => router.push('/profile/edit')}
          />
          <ActionButton
            icon="bar-chart-outline"
            label="Analytics"
            onPress={() => router.push('/analytics')}
          />
          <ActionButton
            icon="person-add-outline"
            label="Requests"
            badge={requestCount}
            onPress={() => router.push('/profile/requests')}
          />
        </View>
      }
    />
  );

  return (
    <ThemedView style={styles.container}>
      <PostGrid
        posts={posts}
        status={gridStatus}
        onRetry={load}
        header={header}
        emptyText="You haven't posted yet."
        onPressPost={(p: GridPost) => router.push(`/post/${p.id}/edit`)}
      />
    </ThemedView>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  badge?: number;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
      ]}>
      <Ionicons name={icon} size={18} color={theme.text} />
      <ThemedText type="small" style={styles.actionLabel}>
        {label}
      </ThemedText>
      {badge ? (
        <View style={styles.badge}>
          <ThemedText type="small" style={styles.badgeText}>
            {badge}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  actionLabel: { fontWeight: '600' },
  badge: {
    backgroundColor: BRAND.accent,
    borderRadius: 999,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: BRAND.onAccent, fontWeight: '700' },
});

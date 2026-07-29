import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { PostGrid } from '@/components/profile/post-grid';
import { ProfileHeader } from '@/components/profile/profile-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import {
  blockUser,
  followUser,
  getProfileOverview,
  getProfilePosts,
  muteUser,
  reportUser,
  unfollowUser,
  unmuteUser,
  type GridPost,
  type ProfileOverview,
} from '@/lib/profile';

export default function PublicProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const theme = useTheme();

  const [overview, setOverview] = useState<ProfileOverview | null>(null);
  const [posts, setPosts] = useState<GridPost[] | null>(null);
  const [gridStatus, setGridStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!handle) return;
    try {
      const ov = await getProfileOverview(handle);
      if (!ov) {
        setStatus('missing');
        return;
      }
      setOverview(ov);
      setStatus('ready');
      if (!ov.locked) {
        setGridStatus('loading');
        try {
          setPosts(await getProfilePosts(ov.id));
          setGridStatus('ready');
        } catch {
          setGridStatus('error');
        }
      }
    } catch {
      setStatus('error');
    }
  }, [handle]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onFollowPress() {
    if (!overview || busy) return;
    setBusy(true);
    try {
      if (overview.follow_status) await unfollowUser(overview.id);
      else await followUser(overview);
      await load();
    } finally {
      setBusy(false);
    }
  }

  function reportFlow() {
    if (!overview) return;
    const reasons = ['Spam', 'Harassment or bullying', 'Inappropriate content'];
    Alert.alert('Report account', 'Why are you reporting this account?', [
      ...reasons.map((r) => ({
        text: r,
        onPress: () =>
          reportUser(overview.id, r).then(() =>
            Alert.alert('Thanks', 'Our team will review this.'),
          ),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }
  function blockFlow() {
    if (!overview) return;
    Alert.alert(
      'Block account',
      `Block @${overview.handle}? They won't see your posts or be able to interact with you.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            await blockUser(overview.id);
            router.back();
          },
        },
      ],
    );
  }
  function openOverflow() {
    if (!overview) return;
    Alert.alert(`@${overview.handle}`, undefined, [
      { text: 'Report', onPress: reportFlow },
      {
        text: overview.is_muting ? 'Unmute' : 'Mute',
        onPress: async () => {
          if (overview.is_muting) await unmuteUser(overview.id);
          else await muteUser(overview.id);
          await load();
        },
      },
      { text: 'Block', style: 'destructive', onPress: blockFlow },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  if (status === 'loading') {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator color={theme.textSecondary} />
      </ThemedView>
    );
  }
  if (status === 'missing' || status === 'error') {
    return (
      <ThemedView style={styles.center}>
        <Stack.Screen options={{ headerShown: true, title: '' }} />
        <ThemedText type="small" themeColor="textSecondary">
          {status === 'missing' ? 'This account doesn’t exist.' : 'Couldn’t load this profile.'}
        </ThemedText>
        <Button title="Go back" variant="secondary" onPress={() => router.back()} />
      </ThemedView>
    );
  }
  if (!overview) return null;

  const followLabel =
    overview.follow_status === 'accepted'
      ? 'Following'
      : overview.follow_status === 'pending'
        ? 'Requested'
        : overview.is_private
          ? 'Request'
          : 'Follow';

  const header = (
    <ProfileHeader
      profile={overview}
      onPressFollowers={() =>
        router.push({
          pathname: '/connections',
          params: { userId: overview.id, type: 'followers', title: overview.handle },
        })
      }
      onPressFollowing={() =>
        router.push({
          pathname: '/connections',
          params: { userId: overview.id, type: 'following', title: overview.handle },
        })
      }
      action={
        overview.is_self ? (
          <Button
            title="Edit profile"
            variant="secondary"
            onPress={() => router.push('/profile/edit')}
          />
        ) : (
          <View style={styles.actionRow}>
            <Button
              title={followLabel}
              variant={overview.follow_status ? 'secondary' : 'primary'}
              onPress={onFollowPress}
              loading={busy}
              style={styles.followBtn}
            />
            <Pressable
              onPress={openOverflow}
              accessibilityLabel="More options"
              style={[styles.overflow, { borderColor: theme.border }]}>
              <Ionicons name="ellipsis-horizontal" size={20} color={theme.text} />
            </Pressable>
          </View>
        )
      }
    />
  );

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: `@${overview.handle}` }} />
      <PostGrid
        posts={posts}
        status={gridStatus}
        onRetry={load}
        header={header}
        locked={overview.locked}
        onPressPost={(p) => router.push(`/post/${p.id}`)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  actionRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  followBtn: { flex: 1 },
  overflow: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

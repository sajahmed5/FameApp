import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { PostGrid } from '@/components/profile/post-grid';
import { ProfileHeader } from '@/components/profile/profile-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionMenu } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import {
  blockUser,
  followUser,
  getProfileOverview,
  getProfilePosts,
  muteUser,
  reportUser,
  unblockUser,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

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

  const doReport = (reason: string) => {
    if (!overview) return;
    reportUser(overview.id, reason)
      .then(() => Alert.alert('Thanks', 'Our team will review this.'))
      .catch(() => {});
  };
  const blockFlow = async () => {
    if (!overview) return;
    const ok = await confirm(
      'Block account',
      `Block @${overview.handle}? They won't see your posts or be able to interact with you.`,
      'Block',
    );
    if (!ok) return;
    await blockUser(overview.id);
    router.back();
  };
  const unblockFlow = async () => {
    if (!overview) return;
    await unblockUser(overview.id);
    await load();
  };
  const toggleMute = async () => {
    if (!overview) return;
    if (overview.is_muting) await unmuteUser(overview.id);
    else await muteUser(overview.id);
    await load();
  };
  const openOverflow = () => setMenuOpen(true);

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

      <ActionMenu
        visible={menuOpen}
        title={`@${overview.handle}`}
        onClose={() => setMenuOpen(false)}
        options={
          overview.is_blocked
            ? [{ label: 'Unblock', onPress: unblockFlow }]
            : [
                { label: 'Report', onPress: () => setReportOpen(true) },
                { label: overview.is_muting ? 'Unmute' : 'Mute', onPress: toggleMute },
                { label: 'Block', destructive: true, onPress: blockFlow },
              ]
        }
      />
      <ActionMenu
        visible={reportOpen}
        title="Report this account"
        onClose={() => setReportOpen(false)}
        options={['Spam', 'Harassment or bullying', 'Inappropriate content'].map((r) => ({
          label: r,
          onPress: () => doReport(r),
        }))}
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

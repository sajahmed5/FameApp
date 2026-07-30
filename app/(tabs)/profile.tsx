import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProfileHeader } from '@/components/profile/profile-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VerifyEmailBanner } from '@/components/verify-email-banner';
import { BRAND, TAB_BAR_CLEARANCE } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { getMySwipes, undoSwipe, type SwipedPost } from '@/lib/deck';
import {
  getPendingRequestCount,
  getProfileOverview,
  getProfilePosts,
  type GridPost,
  type ProfileOverview,
} from '@/lib/profile';

type Tab = 'posts' | 'liked' | 'skipped';
type Cell = { id: string; thumbnail_url: string; media_type: 'image' | 'video' };

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { profile: authProfile } = useAuth();
  const handle = authProfile?.handle;

  const [overview, setOverview] = useState<ProfileOverview | null>(null);
  const [tab, setTab] = useState<Tab>('posts');
  const [posts, setPosts] = useState<GridPost[] | null>(null);
  const [liked, setLiked] = useState<SwipedPost[] | null>(null);
  const [skipped, setSkipped] = useState<SwipedPost[] | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const [headError, setHeadError] = useState(false);

  const load = useCallback(async () => {
    if (!handle) return;
    setHeadError(false);
    try {
      const ov = await getProfileOverview(handle);
      setOverview(ov);
      if (ov) {
        setPosts(await getProfilePosts(ov.id).catch(() => []));
      }
    } catch {
      setHeadError(true);
    }
    setRequestCount(await getPendingRequestCount());
  }, [handle]);

  const loadSwipes = useCallback(async (t: 'liked' | 'skipped') => {
    try {
      const rows = await getMySwipes(t === 'liked' ? 'right' : 'left');
      if (t === 'liked') setLiked(rows);
      else setSkipped(rows);
    } catch {
      if (t === 'liked') setLiked([]);
      else setSkipped([]);
    }
  }, []);

  // Refetch the active swipe tab whenever it becomes active — never show stale data
  // (this is a persistent tab screen, so state survives navigating away and back).
  const tabRef = useRef<Tab>('posts');
  useEffect(() => {
    tabRef.current = tab;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async loader; sets state on resolve
    if (tab !== 'posts') void loadSwipes(tab);
  }, [tab, loadSwipes]);

  // Also refresh on focus (e.g. after liking in the deck, then returning here).
  useFocusEffect(
    useCallback(() => {
      void load();
      if (tabRef.current !== 'posts') void loadSwipes(tabRef.current);
    }, [load, loadSwipes]),
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

  const cells: Cell[] =
    tab === 'posts'
      ? (posts ?? []).map((p) => ({ id: p.id, thumbnail_url: p.thumbnail_url, media_type: p.media_type }))
      : (tab === 'liked' ? liked ?? [] : skipped ?? []).map((s) => ({
          id: s.post_id,
          thumbnail_url: s.thumbnail_url,
          media_type: s.media_type,
        }));
  const loading = tab === 'posts' ? posts === null : tab === 'liked' ? liked === null : skipped === null;
  const emptyText =
    tab === 'posts'
      ? "You haven't posted yet."
      : tab === 'liked'
        ? "You haven't liked anything yet."
        : "You haven't skipped anything yet.";

  const undo = async (postId: string) => {
    try {
      await undoSwipe(postId);
      if (tab === 'liked') setLiked((p) => p?.filter((x) => x.post_id !== postId) ?? p);
      else setSkipped((p) => p?.filter((x) => x.post_id !== postId) ?? p);
    } catch {
      /* ignore */
    }
  };

  const gap = 2;
  const size = (width - gap * 2) / 3;

  const listHeader = (
    <>
      <VerifyEmailBanner />
      <ProfileHeader
        profile={overview}
        points={authProfile?.points_balance ?? 0}
        onPressPoints={() => router.push('/points')}
        onPressFollowers={() => goConnections('followers')}
        onPressFollowing={() => goConnections('following')}
        action={
          <View style={styles.actions}>
            <ActionButton icon="create-outline" label="Edit profile" onPress={() => router.push('/profile/edit')} />
            <ActionButton icon="bar-chart-outline" label="Analytics" onPress={() => router.push('/analytics')} />
            <ActionButton icon="person-add-outline" label="Requests" badge={requestCount} onPress={() => router.push('/profile/requests')} />
          </View>
        }
      />
      <View style={[styles.tabs, { borderTopColor: theme.border, borderBottomColor: theme.border }]}>
        <TabButton icon="grid-outline" active={tab === 'posts'} onPress={() => setTab('posts')} label="Posts" />
        <TabButton icon="heart-outline" active={tab === 'liked'} onPress={() => setTab('liked')} label="Liked" />
        <TabButton icon="close-circle-outline" active={tab === 'skipped'} onPress={() => setTab('skipped')} label="Skipped" />
      </View>
    </>
  );

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={cells}
        keyExtractor={(c, i) => `${tab}:${c.id}:${i}`}
        numColumns={3}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ gap, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            {loading ? (
              <ActivityIndicator color={theme.textSecondary} />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {emptyText}
              </ThemedText>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/post/${item.id}`)}
            style={{ width: size, height: size }}
            accessibilityRole="button"
            accessibilityLabel="Open post">
            <Image source={{ uri: item.thumbnail_url }} style={styles.thumb} contentFit="cover" recyclingKey={item.id} />
            {item.media_type === 'video' ? (
              <View style={[styles.badge, styles.vidBadge]}>
                <Ionicons name="videocam" size={12} color="#fff" />
              </View>
            ) : null}
            {tab !== 'posts' ? (
              <Pressable
                onPress={() => undo(item.id)}
                hitSlop={6}
                style={[styles.badge, styles.undo]}
                accessibilityRole="button"
                accessibilityLabel={tab === 'liked' ? 'Unlike' : 'Un-skip'}>
                <Ionicons name="arrow-undo" size={13} color="#fff" />
              </Pressable>
            ) : null}
          </Pressable>
        )}
      />
    </ThemedView>
  );
}

function TabButton({
  icon,
  active,
  onPress,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  label: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={styles.tab}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}>
      <Ionicons name={icon} size={22} color={active ? BRAND.accent : theme.textSecondary} />
      <View style={[styles.tabUnderline, { backgroundColor: active ? BRAND.accent : 'transparent' }]} />
    </Pressable>
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
      style={({ pressed }) => [styles.action, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={icon} size={18} color={theme.text} />
      <ThemedText type="small" style={styles.actionLabel} numberOfLines={1}>
        {label}
      </ThemedText>
      {badge ? (
        <View style={styles.actionBadge}>
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
    paddingHorizontal: 6,
  },
  actionLabel: { fontWeight: '600' },
  actionBadge: {
    backgroundColor: BRAND.accent,
    borderRadius: 999,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: BRAND.onAccent, fontWeight: '700' },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  tab: { flex: 1, alignItems: 'center', paddingTop: 12, gap: 10 },
  tabUnderline: { height: 2, width: '55%', borderRadius: 1 },
  emptyBox: { paddingVertical: 48, alignItems: 'center' },
  thumb: { width: '100%', height: '100%', backgroundColor: '#111' },
  badge: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, padding: 4 },
  vidBadge: { top: 4, left: 4 },
  undo: { top: 4, right: 4 },
});

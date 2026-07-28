import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { getMyPosts, type MyPost } from '@/lib/posts';

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { profile, user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const [posts, setPosts] = useState<MyPost[] | null>(null);
  const [postsError, setPostsError] = useState(false);

  const loadPosts = useCallback(async () => {
    setPostsError(false);
    try {
      setPosts(await getMyPosts());
    } catch {
      setPostsError(true);
    }
  }, []);

  // Refresh when the tab regains focus (e.g. returning after posting/editing).
  useFocusEffect(
    useCallback(() => {
      void loadPosts();
    }, [loadPosts]),
  );

  async function onSignOut() {
    setSigningOut(true);
    await signOut();
  }

  const gap = 2;
  const size = (width - gap * 2) / 3;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <ThemedText type="title">{profile?.display_name ?? 'Profile'}</ThemedText>
          {profile ? (
            <ThemedText type="default" themeColor="textSecondary">
              @{profile.handle}
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.meta}>
          <Row label="Email" value={user?.email ?? '—'} />
          <Row
            label="Account"
            value={profile ? (profile.is_private ? 'Private' : 'Public') : '—'}
          />
          <Row label="Age band" value={profile?.age_band ?? '—'} />
          <Row label="Points" value={profile ? String(profile.points_balance) : '—'} />
        </View>

        <Button title="Sign out" variant="secondary" onPress={onSignOut} loading={signingOut} />

        {/* Own posts — tap to edit */}
        <View style={styles.postsHeader}>
          <ThemedText type="smallBold">Your posts</ThemedText>
        </View>
        {postsError ? (
          <View style={styles.postsState}>
            <ThemedText type="small" themeColor="textSecondary">
              Couldn&apos;t load your posts.
            </ThemedText>
            <Button title="Retry" variant="secondary" onPress={loadPosts} />
          </View>
        ) : posts === null ? (
          <View style={styles.postsState}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.postsState}>
            <ThemedText type="small" themeColor="textSecondary">
              You haven&apos;t posted yet.
            </ThemedText>
          </View>
        ) : (
          <View style={[styles.grid, { gap }]}>
            {posts.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => router.push(`/post/${p.id}/edit`)}
                style={{ width: size, height: size }}
                accessibilityRole="button"
                accessibilityLabel="Edit post">
                <Image
                  source={{ uri: p.thumbnail_url }}
                  style={styles.thumb}
                  contentFit="cover"
                  recyclingKey={p.id}
                />
                <View style={styles.badges}>
                  {p.visibility === 'private' ? <Badge icon="lock-closed" /> : null}
                  {p.media_type === 'video' ? <Badge icon="videocam" /> : null}
                  {p.moderation_status !== 'approved' ? <Badge icon="time" /> : null}
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function Badge({ icon }: { icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.badge}>
      <Ionicons name={icon} size={12} color="#fff" />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 24, gap: 24 },
  header: { gap: 4, alignItems: 'flex-start' },
  meta: { gap: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  postsHeader: { marginTop: 4 },
  postsState: { paddingVertical: 24, alignItems: 'center', gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -24 },
  thumb: { width: '100%', height: '100%', backgroundColor: '#111' },
  badges: { position: 'absolute', top: 4, right: 4, flexDirection: 'row', gap: 4 },
  badge: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, padding: 4 },
});

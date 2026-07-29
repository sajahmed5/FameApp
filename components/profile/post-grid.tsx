import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTheme } from '@/hooks/use-theme';
import type { GridPost } from '@/lib/profile';

type Props = {
  posts: GridPost[] | null;
  status: 'loading' | 'ready' | 'error';
  onRetry: () => void;
  onPressPost: (post: GridPost) => void;
  /** Header rendered above the grid (profile header, action row). */
  header?: React.ReactElement | null;
  /** Replace the grid with a locked state (private account, not followed). */
  locked?: boolean;
  emptyText?: string;
};

/**
 * Virtualised 3-column grid of a user's own posts (FlatList, not a map over
 * everything). Private posts are badged; tapping a cell calls onPressPost.
 */
export function PostGrid({
  posts,
  status,
  onRetry,
  onPressPost,
  header,
  locked,
  emptyText,
}: Props) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const gap = 2;
  const size = (width - gap * 2) / 3;

  if (locked) {
    return (
      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={header}
        ListFooterComponent={
          <View style={styles.state}>
            <Ionicons name="lock-closed" size={40} color={theme.textSecondary} />
            <ThemedText type="subtitle" style={styles.center}>
              This account is private
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              Follow this account to see their posts.
            </ThemedText>
          </View>
        }
      />
    );
  }

  const footer =
    status === 'loading' ? (
      // Skeleton grid (predictable layout) instead of a bare spinner.
      <View style={styles.skeletonGrid}>
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} style={{ width: size, height: size, borderRadius: 0, margin: gap / 2 }} />
        ))}
      </View>
    ) : status === 'error' ? (
      <View style={styles.state}>
        <ThemedText type="small" themeColor="textSecondary">
          Couldn&apos;t load posts.
        </ThemedText>
        <Button title="Retry" variant="secondary" onPress={onRetry} />
      </View>
    ) : posts && posts.length === 0 ? (
      <View style={styles.state}>
        <Ionicons name="images-outline" size={40} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary">
          {emptyText ?? 'No posts yet.'}
        </ThemedText>
      </View>
    ) : null;

  return (
    <FlatList
      data={posts ?? []}
      keyExtractor={(p) => p.id}
      numColumns={3}
      columnWrapperStyle={{ gap }}
      contentContainerStyle={{ gap }}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      initialNumToRender={18}
      windowSize={5}
      removeClippedSubviews
      renderItem={({ item }) => (
        <Pressable
          onPress={() => onPressPost(item)}
          style={{ width: size, height: size }}
          accessibilityRole="button"
          accessibilityLabel={`${item.media_type === 'video' ? 'Video' : 'Photo'} post${item.visibility === 'private' ? ', private' : ''}`}>
          <Image
            source={{ uri: item.thumbnail_url }}
            style={styles.thumb}
            contentFit="cover"
            recyclingKey={item.id}
          />
          <View style={styles.badges}>
            {item.visibility === 'private' ? <Badge icon="lock-closed" /> : null}
            {item.media_type === 'video' ? <Badge icon="videocam" /> : null}
            {item.moderation_status !== 'approved' ? <Badge icon="time" /> : null}
          </View>
        </Pressable>
      )}
    />
  );
}

function Badge({ icon }: { icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.badge}>
      <Ionicons name={icon} size={12} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { width: '100%', height: '100%', backgroundColor: '#111' },
  badges: { position: 'absolute', top: 4, right: 4, flexDirection: 'row', gap: 4 },
  badge: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, padding: 4 },
  state: { paddingVertical: 40, alignItems: 'center', gap: 12 },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  center: { textAlign: 'center' },
});

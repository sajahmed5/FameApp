import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { PAGE, getTagMeta, searchPostsByTag, type SearchPost, type TagMeta } from '@/lib/search';

/**
 * Tag page: name, post count, and a grid of recent posts. Tap a post to swipe through
 * everything with this tag. Tags aren't followed — this is a browse/discover surface.
 */
export default function TagPage() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - 4) / 3);

  const [meta, setMeta] = useState<TagMeta | null>(null);
  const [posts, setPosts] = useState<SearchPost[]>([]);
  // #33: ids of listed posts I've right-swiped — shown as a small heart badge. Tag pages
  // deliberately show EVERYTHING (they're a browse surface); the badge just tells you
  // which ones you've already liked.
  const [liked, setLiked] = useState<Set<string>>(new Set());

  const markLiked = useCallback(async (rows: SearchPost[]) => {
    if (rows.length === 0) return;
    const { data } = await supabase
      .from('swipes')
      .select('post_id')
      .eq('direction', 'right')
      .in('post_id', rows.map((r) => r.id));
    if (data?.length) {
      setLiked((prev) => {
        const next = new Set(prev);
        for (const r of data as { post_id: string }[]) next.add(r.post_id);
        return next;
      });
    }
  }, []);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offset = useRef(0);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const [m, p] = await Promise.all([getTagMeta(name), searchPostsByTag(name, 0)]);
        if (!live) return;
        setMeta(m);
        setPosts(p);
        void markLiked(p);
        setHasMore(p.length === PAGE);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [name, markLiked]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    offset.current += PAGE;
    try {
      const p = await searchPostsByTag(name, offset.current);
      setPosts((prev) => [...prev, ...p]);
      void markLiked(p);
      setHasMore(p.length === PAGE);
    } catch {
      /* keep */
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, name, markLiked]);

  return (
    <ThemedView style={{ flex: 1, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </Pressable>
        <ThemedText type="subtitle" numberOfLines={1} style={{ flex: 1 }}>
          #{name}
        </ThemedText>
      </View>

      <FlatList
        data={posts}
        numColumns={3}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        ListHeaderComponent={
          <View style={styles.meta}>
            <View style={{ flex: 1 }}>
              <ThemedText type="title">#{name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {(meta?.post_count ?? 0).toLocaleString()} {meta?.post_count === 1 ? 'post' : 'posts'} · tap a post to swipe
              </ThemedText>
            </View>
          </View>
        }
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/deck', params: { tag: name, start: String(index) } })}
            style={{ width: cell, height: cell, padding: 1 }}>
            <Image source={{ uri: item.thumbnail_url }} style={styles.gridImg} contentFit="cover" recyclingKey={item.id} />
            {item.media_type === 'video' ? (
              <View style={styles.playBadge}>
                <Ionicons name="play" size={12} color="#fff" />
              </View>
            ) : null}
            {liked.has(item.id) ? (
              <View style={styles.likedBadge}>
                <Ionicons name="heart" size={11} color="#fff" />
              </View>
            ) : null}
          </Pressable>
        )}
        onEndReachedThreshold={0.5}
        onEndReached={loadMore}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ padding: 24 }} color={theme.textSecondary} />
          ) : (
            <ThemedText type="default" themeColor="textSecondary" style={{ textAlign: 'center', padding: 24 }}>
              No posts with this tag yet.
            </ThemedText>
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ padding: 16 }} color={theme.textSecondary} /> : null}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  followBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, minWidth: 96, alignItems: 'center' },
  gridImg: { flex: 1, borderRadius: 2, backgroundColor: '#222' },
  likedBadge: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 9,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, padding: 3 },
});

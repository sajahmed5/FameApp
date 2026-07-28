import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import {
  PAGE,
  followTag,
  getTagMeta,
  searchPostsByTag,
  unfollowTag,
  type SearchPost,
  type TagMeta,
} from '@/lib/search';

/**
 * Tag page: name, post count, a grid of recent posts, and a follow button.
 * Following weights the tag into user_tags, which nudges the Home deck.
 */
export default function TagPage() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - 4) / 3);

  const [meta, setMeta] = useState<TagMeta | null>(null);
  const [posts, setPosts] = useState<SearchPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
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
        setHasMore(p.length === PAGE);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [name]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    offset.current += PAGE;
    try {
      const p = await searchPostsByTag(name, offset.current);
      setPosts((prev) => [...prev, ...p]);
      setHasMore(p.length === PAGE);
    } catch {
      /* keep */
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, name]);

  const toggleFollow = async () => {
    if (!meta || busy) return;
    setBusy(true);
    const prev = meta.is_following;
    setMeta({ ...meta, is_following: !prev });
    try {
      if (prev) await unfollowTag(name);
      else await followTag(name);
    } catch {
      setMeta((m) => (m ? { ...m, is_following: prev } : m));
    } finally {
      setBusy(false);
    }
  };

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
                {(meta?.post_count ?? 0).toLocaleString()} {meta?.post_count === 1 ? 'post' : 'posts'}
              </ThemedText>
            </View>
            <Pressable
              onPress={toggleFollow}
              disabled={busy || !meta}
              style={[
                styles.followBtn,
                meta?.is_following ? { borderColor: theme.border } : { backgroundColor: theme.tint, borderColor: theme.tint },
              ]}>
              <ThemedText type="small" style={{ color: meta?.is_following ? theme.text : '#fff', fontWeight: '700' }}>
                {meta?.is_following ? 'Following' : 'Follow'}
              </ThemedText>
            </Pressable>
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
  playBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, padding: 3 },
});

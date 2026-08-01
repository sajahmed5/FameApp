import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';

import { VideoOverlays } from '@/components/video-overlays';
import { parseVideoOverlays } from '@/lib/video-overlays';
import { memo, useCallback, useEffect, useState, useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CollectionPicker } from '@/components/collection-picker';
import { CommentSheet } from '@/components/comments/comment-sheet';
import { FollowingEmpty } from '@/components/deck/following-empty';
import { StoriesRail } from '@/components/deck/stories-rail';
import { MentionText } from '@/components/mention-text';
import { ShareSheet } from '@/components/share-sheet';
import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { BRAND, TAB_BAR_CLEARANCE } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { getBookmarkState } from '@/lib/bookmarks';
import { fetchFollowingFeed, recordSwipe, type DeckCard } from '@/lib/deck';
import { formatCount } from '@/lib/format';
import { getExtrasForPosts, type PostMediaItem } from '@/lib/posts';
import { resolveDeckMedia } from '@/lib/media';
import { formatRelative } from '@/lib/relative-time';

const PAGE = 15;

/**
 * Persistent Instagram/TikTok-style feed for the Following tab: a scrollable list of
 * recent posts from accounts you follow, paginated, NOT consumed by swiping. Like opens
 * a right-swipe (private, as everywhere); comment/share reuse the shared sheets.
 */
export function FollowingFeed() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [cards, setCards] = useState<DeckCard[] | null>(null); // null = first load
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [commentsFor, setCommentsFor] = useState<DeckCard | null>(null);
  const [shareFor, setShareFor] = useState<DeckCard | null>(null);
  const [extrasMap, setExtrasMap] = useState<Map<string, PostMediaItem[]>>(new Map());

  const load = useCallback(async () => {
    try {
      const first = await resolveDeckMedia(await fetchFollowingFeed(null, PAGE));
      setCards(first);
      setAtEnd(first.length < PAGE);
      getExtrasForPosts(first.map((c) => c.id)).then(setExtrasMap).catch(() => {});
    } catch {
      setCards([]);
    }
  }, []);

  // Reload whenever the tab regains focus — so following someone from elsewhere
  // (e.g. a profile) makes their posts appear here without a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || atEnd || !cards || cards.length === 0) return;
    setLoadingMore(true);
    try {
      const before = cards[cards.length - 1].created_at;
      const next = await resolveDeckMedia(await fetchFollowingFeed(before, PAGE));
      setCards((prev) => [...(prev ?? []), ...next]);
      if (next.length < PAGE) setAtEnd(true);
      getExtrasForPosts(next.map((c) => c.id))
        .then((m) => setExtrasMap((prev) => new Map([...prev, ...m])))
        .catch(() => {});
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }, [cards, loadingMore, atEnd]);

  const bumpComments = useCallback((id: string, d: number) => {
    setCards((prev) =>
      prev?.map((c) => (c.id === id ? { ...c, comment_count: Math.max(0, c.comment_count + d) } : c)) ?? prev,
    );
  }, []);

  if (cards === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={cards}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={<StoriesRail />}
        ListEmptyComponent={<FollowingEmpty onReload={refresh} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.textSecondary} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        renderItem={({ item }) => (
          <FeedCard
            card={item}
            extras={extrasMap.get(item.id) ?? NO_EXTRAS}
            onOpenComments={() => setCommentsFor(item)}
            onOpenShare={() => setShareFor(item)}
          />
        )}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={{ padding: 16 }} color={theme.textSecondary} /> : null
        }
      />

      {commentsFor ? (
        <CommentSheet
          postId={commentsFor.id}
          onClose={() => setCommentsFor(null)}
          onCountDelta={(d) => bumpComments(commentsFor.id, d)}
        />
      ) : null}
      {shareFor ? (
        <ShareSheet
          post={{ id: shareFor.id, caption: shareFor.caption }}
          allowExternal
          onClose={() => setShareFor(null)}
        />
      ) : null}
    </>
  );
}

const NO_EXTRAS: PostMediaItem[] = [];

const FeedCard = memo(function FeedCard({
  card,
  extras,
  onOpenComments,
  onOpenShare,
}: {
  card: DeckCard;
  extras: PostMediaItem[];
  onOpenComments: () => void;
  onOpenShare: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { width: winW } = useWindowDimensions();
  const [page, setPage] = useState(0);
  // Pre-fill the heart if you already swiped right on this post (e.g. from the main deck).
  const [liked, setLiked] = useState(card.my_direction === 'right');
  const [likeCount, setLikeCount] = useState(card.like_count);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getBookmarkState(card.id)
      .then((s) => alive && setSaved(s.saved))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [card.id]);

  // Like = a private right-swipe (same commit path as the deck). One-way for now.
  const like = () => {
    if (liked) return;
    setLiked(true);
    setLikeCount((n) => n + 1);
    recordSwipe(card.id, 'right').catch(() => {
      setLiked(false);
      setLikeCount((n) => Math.max(0, n - 1));
    });
  };

  return (
    <View style={[styles.card, { borderBottomColor: theme.border }]}>
      <Pressable
        style={styles.header}
        onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: card.poster_handle } })}
        accessibilityRole="button"
        accessibilityLabel={`Open @${card.poster_handle}`}>
        <Avatar uri={card.poster_avatar_url} name={card.poster_display_name} handle={card.poster_handle} size={38} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {card.poster_display_name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            @{card.poster_handle} · {formatRelative(card.created_at)}
          </ThemedText>
        </View>
      </Pressable>

      {extras.length === 0 ? (
        card.media_type === 'video' ? (
          <FeedVideo uri={card.media_url} overlays={card.overlays} />
        ) : (
          <Image
            source={{ uri: card.media_url }}
            style={styles.media}
            contentFit="cover"
            accessibilityLabel={card.alt_text ?? undefined}
          />
        )
      ) : (
        // Carousel: horizontal pager (cover + extras) with a counter pill + dots.
        <View>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / winW))}
            scrollEventThrottle={16}
            style={{ width: winW }}>
            {[{ media_url: card.media_url, media_type: card.media_type }, ...extras].map((m, i) => (
              <View key={i} style={{ width: winW }}>
                {m.media_type === 'video' ? (
                  <FeedVideo uri={m.media_url} />
                ) : (
                  <Image source={{ uri: m.media_url }} style={styles.media} contentFit="cover" />
                )}
              </View>
            ))}
          </ScrollView>
          <View style={styles.pagePill}>
            <ThemedText type="small" style={{ color: '#fff' }}>{page + 1}/{extras.length + 1}</ThemedText>
          </View>
          <View style={styles.dots}>
            {Array.from({ length: extras.length + 1 }).map((_, i) => (
              <View key={i} style={[styles.dot, { backgroundColor: i === page ? BRAND.accent : theme.backgroundSelected }]} />
            ))}
          </View>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable onPress={like} hitSlop={8} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="Like">
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={24} color={liked ? BRAND.accent : theme.text} />
          <ThemedText type="smallBold">{formatCount(likeCount)}</ThemedText>
        </Pressable>
        <Pressable onPress={onOpenComments} hitSlop={8} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="Comments">
          <Ionicons name="chatbubble-outline" size={22} color={theme.text} />
          <ThemedText type="smallBold">{formatCount(card.comment_count)}</ThemedText>
        </Pressable>
        <Pressable onPress={onOpenShare} hitSlop={8} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="Share">
          <Ionicons name="paper-plane-outline" size={22} color={theme.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setSaveOpen(true)} hitSlop={8} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel={saved ? 'Saved — edit collection' : 'Save'}>
          <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={22} color={saved ? BRAND.accent : theme.text} />
        </Pressable>
      </View>

      {saveOpen ? (
        <CollectionPicker postId={card.id} visible={saveOpen} onClose={() => setSaveOpen(false)} onChange={setSaved} />
      ) : null}

      {card.caption ? (
        <MentionText type="default" style={styles.caption} numberOfLines={5}>
          {card.caption}
        </MentionText>
      ) : null}

      {card.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {card.tags.map((t) => (
            <Pressable
              key={t}
              onPress={() => router.push({ pathname: '/tag/[name]', params: { name: t } })}
              accessibilityRole="button"
              accessibilityLabel={`See the ${t} tag`}>
              <ThemedText type="small" style={{ color: theme.tint }}>
                #{t}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
});

function FeedVideo({ uri, overlays }: { uri: string; overlays?: unknown }) {
  const overlaysParsed = useMemo(() => parseVideoOverlays(overlays), [overlays]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <View onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <VideoView player={player} style={styles.media} contentFit="cover" nativeControls={false} />
      <VideoOverlays overlays={overlaysParsed} width={box.w} height={box.h} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 12, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  media: { width: '100%', aspectRatio: 4 / 5, backgroundColor: '#111' },
  pagePill: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 14, paddingTop: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  caption: { paddingHorizontal: 14, paddingTop: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 14, paddingTop: 6 },
});

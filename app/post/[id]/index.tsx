import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { CollectionPicker } from '@/components/collection-picker';
import { CommentSheet } from '@/components/comments/comment-sheet';
import { MentionText } from '@/components/mention-text';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionMenu } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { getBookmarkState } from '@/lib/bookmarks';
import { confirm } from '@/lib/confirm';
import { recordSwipe, undoSwipe } from '@/lib/deck';
import { formatCount } from '@/lib/format';
import { deletePost, getPostDetail, getPostExtras, POST_REPORT_REASONS, reportPost, type PostDetail, type PostMediaItem } from '@/lib/posts';

export default function PostViewScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width: winW } = useWindowDimensions();
  const pageW = winW - 32; // styles.content horizontal padding
  const [post, setPost] = useState<PostDetail | null>(null);
  const [ownerMenu, setOwnerMenu] = useState(false);
  const [extras, setExtras] = useState<PostMediaItem[]>([]);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  // Local like/skip state so the viewer can toggle (like ↔ unlike, skip ↔ un-skip).
  const [myDir, setMyDir] = useState<'left' | 'right' | null>(null);
  const [likeCount, setLikeCount] = useState(0);
  const [skipCount, setSkipCount] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    setStatus('loading');
    try {
      const data = await getPostDetail(id);
      if (!data) {
        setStatus('missing'); // RLS hides posts you can't see
        return;
      }
      setPost(data);
      setCommentCount(data.comment_count);
      setMyDir(data.my_direction);
      setLikeCount(data.like_count);
      setSkipCount(data.skip_count);
      setStatus('ready');
      getBookmarkState(id).then((s) => setSaved(s.saved)).catch(() => {});
      getPostExtras(id).then(setExtras).catch(() => setExtras([]));
    } catch {
      setStatus('error');
    }
  }, [id]);

  const setDirection = useCallback(
    async (target: 'left' | 'right' | null) => {
      if (!id) return;
      const cur = myDir;
      if (cur === target) return;
      // Optimistic: adjust the toggle + counts, revert on failure.
      const adjust = (sign: number, d: 'left' | 'right' | null) => {
        if (d === 'right') setLikeCount((n) => Math.max(0, n + sign));
        if (d === 'left') setSkipCount((n) => Math.max(0, n + sign));
      };
      setMyDir(target);
      adjust(-1, cur);
      adjust(+1, target);
      try {
        if (cur) await undoSwipe(id);
        if (target) await recordSwipe(id, target);
      } catch {
        setMyDir(cur);
        adjust(+1, cur);
        adjust(-1, target);
      }
    },
    [id, myDir],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-loader; sets loading/error state internally
    void load();
  }, [load]);

  const doReport = (reason: string) => {
    if (!post) return;
    reportPost(post.id, reason)
      .then(() => Alert.alert('Thanks for reporting', 'Our team will review this post.'))
      .catch(() => Alert.alert("Couldn't report", 'Please try again in a moment.'));
  };

  if (status === 'loading')
    return (
      <ThemedView style={styles.center}>
        <Stack.Screen options={{ headerShown: true, title: 'Post' }} />
        <ActivityIndicator color={theme.textSecondary} />
      </ThemedView>
    );
  if (status !== 'ready' || !post) {
    return (
      <ThemedView style={styles.center}>
        <Stack.Screen options={{ headerShown: true, title: 'Post' }} />
        <ThemedText type="small" themeColor="textSecondary">
          {status === 'missing' ? 'This post isn’t available.' : 'Couldn’t load this post.'}
        </ThemedText>
        <Button title="Go back" variant="secondary" onPress={() => router.back()} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: `@${post.handle}`,
          headerRight: () => (
            <View style={styles.headerRight}>
              <Pressable
                onPress={() => setSaveOpen(true)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={saved ? 'Saved — edit collection' : 'Save this post'}>
                <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={20} color={saved ? theme.tint : theme.text} />
              </Pressable>
              <Pressable
                onPress={() => setReportOpen(true)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Report this post">
                <Ionicons name="flag-outline" size={20} color={theme.text} />
              </Pressable>
            </View>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {extras.length === 0 ? (
          post.media_type === 'video' ? (
            <PostVideo uri={post.media_url} />
          ) : (
            <Image source={{ uri: post.media_url }} style={styles.media} contentFit="cover" />
          )
        ) : (
          // Carousel: cover + extras in a horizontal pager with dots + counter.
          <View>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / pageW))}
              scrollEventThrottle={16}
              style={{ width: pageW, borderRadius: 16 }}>
              {[{ media_url: post.media_url, media_type: post.media_type }, ...extras].map((m, i) => (
                <View key={i} style={{ width: pageW }}>
                  {m.media_type === 'video' ? (
                    <PostVideo uri={m.media_url} />
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
                <View key={i} style={[styles.dot, { backgroundColor: i === page ? theme.tint : theme.backgroundSelected }]} />
              ))}
            </View>
          </View>
        )}

        {/* Tap the heart to like/unlike, the cross to skip/un-skip. */}
        <View style={styles.stats}>
          <Stat
            icon={myDir === 'right' ? 'heart' : 'heart-outline'}
            value={likeCount}
            tint={myDir === 'right' ? BRAND.accent : theme.text}
            onPress={() => setDirection(myDir === 'right' ? null : 'right')}
          />
          <Stat
            icon={myDir === 'left' ? 'close-circle' : 'close'}
            value={skipCount}
            tint={myDir === 'left' ? BRAND.accent : theme.textSecondary}
            onPress={() => setDirection(myDir === 'left' ? null : 'left')}
          />
          <Stat
            icon="chatbubble-outline"
            value={commentCount}
            tint={theme.textSecondary}
            onPress={() => setCommentsOpen(true)}
          />
          <View style={{ flex: 1 }} />
          {post.user_id === user?.id ? (
            <Pressable
              onPress={() => setOwnerMenu(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Edit or delete this post">
              <Ionicons name="create-outline" size={22} color={theme.text} />
            </Pressable>
          ) : null}
        </View>

        {post.caption ? (
          <MentionText type="default" style={styles.caption}>
            {post.caption}
          </MentionText>
        ) : null}

        {post.tags.length > 0 ? (
          <View style={styles.tagRow}>
            {post.tags.map((t) => (
              <Pressable
                key={t}
                onPress={() => router.push({ pathname: '/tag/[name]', params: { name: t } })}
                accessibilityRole="button"
                accessibilityLabel={`See the ${t} tag`}
                style={[styles.tag, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small" style={{ color: theme.tint }}>
                  #{t}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable
          onPress={() => setCommentsOpen(true)}
          accessibilityRole="button"
          style={[styles.commentsBtn, { borderColor: theme.border }]}>
          <Ionicons name="chatbubble-outline" size={18} color={theme.text} />
          <ThemedText type="smallBold">
            {commentCount > 0
              ? `View ${commentCount} comment${commentCount === 1 ? '' : 's'}`
              : 'Add a comment'}
          </ThemedText>
        </Pressable>
      </ScrollView>

      {commentsOpen ? (
        <CommentSheet
          postId={post.id}
          onClose={() => setCommentsOpen(false)}
          onCountDelta={(d) => setCommentCount((c) => Math.max(0, c + d))}
        />
      ) : null}

      <ActionMenu
        visible={reportOpen}
        title="Report this post"
        onClose={() => setReportOpen(false)}
        options={POST_REPORT_REASONS.map((r) => ({ label: r, onPress: () => doReport(r) }))}
      />

      <CollectionPicker postId={post.id} visible={saveOpen} onClose={() => setSaveOpen(false)} onChange={setSaved} />

      <ActionMenu
        visible={ownerMenu}
        title="Your post"
        onClose={() => setOwnerMenu(false)}
        options={[
          { label: 'Edit post', onPress: () => router.push({ pathname: '/post/[id]/edit', params: { id: post.id } }) },
          {
            label: 'Delete post',
            destructive: true,
            onPress: async () => {
              if (!(await confirm('Delete post?', 'This permanently removes it and its comments. This cannot be undone.', 'Delete'))) return;
              try {
                await deletePost(post.id);
                router.back();
              } catch {
                Alert.alert('Could not delete', 'Please try again.');
              }
            },
          },
        ]}
      />
    </ThemedView>
  );
}

function Stat({
  icon,
  value,
  tint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  tint: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={8}
      accessibilityRole="button"
      style={styles.stat}>
      <Ionicons name={icon} size={20} color={tint} />
      <ThemedText type="smallBold">{formatCount(value)}</ThemedText>
    </Pressable>
  );
}

function PostVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
    p.play();
  });
  return <VideoView player={player} style={styles.media} contentFit="cover" />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  content: { padding: 16, gap: 14 },
  media: { width: '100%', aspectRatio: 4 / 5, borderRadius: 16, backgroundColor: '#000' },
  pagePill: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  stats: { flexDirection: 'row', gap: 20 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  caption: {},
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  commentsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
  },
});

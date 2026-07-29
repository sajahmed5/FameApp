import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { CommentSheet } from '@/components/comments/comment-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionMenu } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { formatCount } from '@/lib/format';
import { getPostDetail, POST_REPORT_REASONS, reportPost, type PostDetail } from '@/lib/posts';

export default function PostViewScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);

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
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [id]);

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
            <Pressable
              onPress={() => setReportOpen(true)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Report this post">
              <Ionicons name="flag-outline" size={20} color={theme.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {post.media_type === 'video' ? (
          <PostVideo uri={post.media_url} />
        ) : (
          <Image source={{ uri: post.media_url }} style={styles.media} contentFit="cover" />
        )}

        {/* Likes · skips · comments */}
        <View style={styles.stats}>
          <Stat icon="heart" value={post.like_count} tint={theme.tint} />
          <Stat icon="close" value={post.skip_count} tint={theme.textSecondary} />
          <Stat icon="chatbubble-outline" value={commentCount} tint={theme.textSecondary} />
        </View>

        {post.caption ? (
          <ThemedText type="default" style={styles.caption}>
            {post.caption}
          </ThemedText>
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
    </ThemedView>
  );
}

function Stat({
  icon,
  value,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  tint: string;
}) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={18} color={tint} />
      <ThemedText type="smallBold">{formatCount(value)}</ThemedText>
    </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  content: { padding: 16, gap: 14 },
  media: { width: '100%', aspectRatio: 4 / 5, borderRadius: 16, backgroundColor: '#000' },
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

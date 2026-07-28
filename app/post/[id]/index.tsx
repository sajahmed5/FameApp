import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { CommentSheet } from '@/components/comments/comment-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { signMediaPaths } from '@/lib/media';
import { supabase } from '@/lib/supabase';

type PostView = {
  id: string;
  media_url: string;
  media_type: 'image' | 'video';
  caption: string | null;
  comment_count: number;
  handle: string;
  display_name: string;
};

export default function PostViewScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [post, setPost] = useState<PostView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    setStatus('loading');
    const { data, error } = await supabase
      .from('posts')
      .select(
        'id, media_url, media_type, caption, comment_count, profiles!posts_user_id_fkey(handle, display_name)',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) {
      setStatus('error');
      return;
    }
    if (!data) {
      setStatus('missing');
      return;
    } // RLS hides posts you can't see
    const row = data as unknown as PostView & {
      profiles: { handle: string; display_name: string };
    };
    const signed = await signMediaPaths([row.media_url]);
    setPost({
      ...row,
      media_url: signed.get(row.media_url) ?? row.media_url,
      handle: row.profiles.handle,
      display_name: row.profiles.display_name,
    });
    setCommentCount(row.comment_count);
    setStatus('ready');
  }, [id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-loader
  useEffect(() => {
    void load();
  }, [load]);

  if (status === 'loading')
    return (
      <ThemedView style={styles.center}>
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
      <Stack.Screen options={{ headerShown: true, title: `@${post.handle}` }} />
      <ScrollView contentContainerStyle={styles.content}>
        {post.media_type === 'video' ? (
          <PostVideo uri={post.media_url} />
        ) : (
          <Image source={{ uri: post.media_url }} style={styles.media} contentFit="cover" />
        )}
        {post.caption ? (
          <ThemedText type="default" style={styles.caption}>
            {post.caption}
          </ThemedText>
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
    </ThemedView>
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
  caption: {},
  commentsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
  },
});

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ActionMenu } from '@/components/ui/action-menu';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { blockUser, reportUser } from '@/lib/profile';
import { formatRelative } from '@/lib/relative-time';
import { deleteStory, getStoryViewers, getUserStories, markStoryViewed, replyToStory, type Story, type StoryViewer } from '@/lib/stories';
import { supabase } from '@/lib/supabase';

const { width: W, height: H } = Dimensions.get('window');
const IMAGE_MS = 5000;
const MAX_VIDEO_MS = 15000;

export default function StoryViewerScreen() {
  const { userId, ids } = useLocalSearchParams<{ userId: string; ids?: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const accounts = useMemo(() => (ids ? ids.split(',').filter(Boolean) : [userId]), [ids, userId]);
  const [accountIndex, setAccountIndex] = useState(Math.max(0, accounts.indexOf(userId)));
  const [stories, setStories] = useState<Story[]>([]);
  const [seg, setSeg] = useState(0);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [ownerName, setOwnerName] = useState('');
  const [ownerAvatar, setOwnerAvatar] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [menu, setMenu] = useState(false);
  const [viewers, setViewers] = useState<StoryViewer[] | null>(null);

  const progress = useSharedValue(0);
  const currentUserId = accounts[accountIndex];
  const story = stories[seg];

  // ---- load an account's stories when the account changes ----
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load this account's stories
    setLoading(true);
    setStories([]);
    void supabase
      .from('profiles')
      .select('display_name, handle, avatar_url')
      .eq('id', currentUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return;
        setOwnerName(data.display_name ?? data.handle);
        setOwnerAvatar(data.avatar_url);
      });
    void getUserStories(currentUserId)
      .then((s) => {
        if (!alive) return;
        setStories(s);
        const firstUnviewed = s.findIndex((x) => !x.viewed && !x.is_self);
        setSeg(firstUnviewed >= 0 ? firstUnviewed : 0);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [currentUserId]);

  // ---- video player for the current segment ----
  const player = useVideoPlayer(story?.media_type === 'video' ? story.media_url : null, (p) => {
    p.loop = false;
    p.muted = false;
  });

  const nextAccount = useCallback(() => {
    if (accountIndex < accounts.length - 1) setAccountIndex((i) => i + 1);
    else router.back();
  }, [accountIndex, accounts.length]);
  const prevAccount = useCallback(() => {
    if (accountIndex > 0) setAccountIndex((i) => i - 1);
  }, [accountIndex]);

  const advance = useCallback(() => {
    setSeg((s) => {
      if (s < stories.length - 1) return s + 1;
      // end of this account → next account (async via effect below)
      runOnJS(nextAccount)();
      return s;
    });
  }, [stories.length, nextAccount]);
  const back = useCallback(() => {
    setSeg((s) => {
      if (s > 0) return s - 1;
      runOnJS(prevAccount)();
      return s;
    });
  }, [prevAccount]);

  // ---- drive the segment: progress bar + auto-advance + mark viewed + prefetch ----
  useEffect(() => {
    if (!story || loading) return;
    void markStoryViewed(story.id);
    // prefetch the next segment's media so it doesn't stall
    const nextStory = stories[seg + 1];
    if (nextStory?.media_type === 'image') void Image.prefetch(nextStory.media_url);

    progress.value = 0;
    if (story.media_type === 'image') {
      if (!paused) progress.value = withTiming(1, { duration: IMAGE_MS }, (f) => { if (f) runOnJS(advance)(); });
      return () => cancelAnimation(progress);
    }
    return;
    // video handled by the timeUpdate effect below
  }, [story, loading, seg, stories, paused, advance, progress]);

  // video playback → progress + advance on end
  useEffect(() => {
    if (!story || story.media_type !== 'video') return;
    if (paused) {
      player.pause();
      return;
    }
    player.play();
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const dur = Math.min(player.duration || MAX_VIDEO_MS / 1000, MAX_VIDEO_MS / 1000);
      progress.value = Math.min(1, currentTime / dur);
      if (currentTime >= dur) advance();
    });
    return () => sub.remove();
  }, [story, paused, player, advance, progress]);

  // ---- gestures ----
  const holdStart = useRef(0);
  const pan = Gesture.Pan()
    .activeOffsetY([-18, 18])
    .activeOffsetX([-18, 18])
    .onEnd((e) => {
      'worklet';
      if (e.translationY > 100) runOnJS(router.back)();
      else if (e.translationY < -70) runOnJS(setReplying)(true);
      else if (e.translationX < -60) runOnJS(nextAccount)();
      else if (e.translationX > 60) runOnJS(prevAccount)();
    });

  const barStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const onReplySend = async () => {
    const t = replyText.trim();
    if (!t || !currentUserId) return;
    setReplyText('');
    setReplying(false);
    try {
      await replyToStory(currentUserId, t);
      Alert.alert('Sent', 'Your reply was sent as a message.');
    } catch {
      Alert.alert('Could not send', 'Please try again.');
    }
  };

  const openViewers = async () => {
    if (!story?.is_self) return;
    setPaused(true);
    setViewers(await getStoryViewers(story.id).catch(() => []));
  };

  const confirmDelete = async () => {
    if (!story?.is_self) return;
    const id = story.id;
    setPaused(true);
    // `confirm` is cross-platform (window.confirm on web, native alert on device);
    // React Native's Alert.alert is a no-op on web, so the PWA needs this.
    const ok = await confirm('Delete story?', 'This removes it for everyone.', 'Delete');
    if (!ok) {
      setPaused(false);
      return;
    }
    try {
      await deleteStory(id);
    } catch {
      setPaused(false);
      await confirm('Could not delete', 'Please try again.', 'OK');
      return;
    }
    const remaining = stories.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      router.back();
      return;
    }
    setSeg((s) => Math.min(s, remaining.length - 1));
    setStories(remaining);
    setPaused(false);
  };

  return (
    <View style={styles.container}>
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill}>
          {loading || !story ? (
            <View style={styles.center}><ActivityIndicator color="#fff" /></View>
          ) : story.media_type === 'video' ? (
            <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} pointerEvents="none" />
          ) : (
            <Image source={{ uri: story.media_url }} style={StyleSheet.absoluteFill} contentFit="contain" transition={120} />
          )}

          {story?.overlay_text ? (
            <View style={styles.overlayWrap} pointerEvents="none">
              <ThemedText type="title" style={styles.overlayText}>{story.overlay_text}</ThemedText>
            </View>
          ) : null}

          {/* tap zones + hold to pause */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPressIn={() => {
              holdStart.current = Date.now();
              setPaused(true);
            }}
            onPressOut={(e) => {
              const held = Date.now() - holdStart.current;
              setPaused(false);
              if (held < 250) {
                if (e.nativeEvent.locationX < W / 3) back();
                else advance();
              }
            }}
          />
        </View>
      </GestureDetector>

      {/* progress segments */}
      <View style={[styles.bars, { top: insets.top + 6 }]} pointerEvents="none">
        {stories.map((s, i) => (
          <View key={s.id} style={styles.barTrack}>
            <Animated.View style={[styles.barFill, i < seg ? { width: '100%' } : i === seg ? barStyle : { width: '0%' }]} />
          </View>
        ))}
      </View>

      {/* header */}
      <View style={[styles.header, { top: insets.top + 16 }]}>
        {ownerAvatar ? <Image source={{ uri: ownerAvatar }} style={styles.headerAvatar} contentFit="cover" /> : <View style={[styles.headerAvatar, { backgroundColor: '#444' }]} />}
        <ThemedText type="smallBold" style={{ color: '#fff', flex: 1 }} numberOfLines={1}>{ownerName}</ThemedText>
        {story ? <ThemedText type="small" style={{ color: 'rgba(255,255,255,0.8)' }}>{formatRelative(story.created_at)}</ThemedText> : null}
        {story?.is_self ? (
          <Pressable onPress={confirmDelete} hitSlop={8} accessibilityLabel="Delete story"><Ionicons name="trash-outline" size={21} color="#fff" /></Pressable>
        ) : (
          <Pressable onPress={() => setMenu(true)} hitSlop={8}><Ionicons name="ellipsis-horizontal" size={22} color="#fff" /></Pressable>
        )}
        <Pressable onPress={() => router.back()} hitSlop={8}><Ionicons name="close" size={24} color="#fff" /></Pressable>
      </View>

      {/* footer: own → viewers; others → reply */}
      {story?.is_self ? (
        <Pressable onPress={openViewers} style={[styles.footerSelf, { bottom: insets.bottom + 16 }]}>
          <Ionicons name="eye-outline" size={18} color="#fff" />
          <ThemedText type="small" style={{ color: '#fff' }}>Viewers</ThemedText>
        </Pressable>
      ) : (
        <Pressable onPress={() => { setPaused(true); setReplying(true); }} style={[styles.replyPrompt, { bottom: insets.bottom + 16 }]}>
          <ThemedText type="small" style={{ color: 'rgba(255,255,255,0.9)' }}>Reply to {ownerName}…</ThemedText>
        </Pressable>
      )}

      {/* reply composer */}
      {replying ? (
        <View style={[styles.replyBar, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            value={replyText}
            onChangeText={setReplyText}
            placeholder={`Reply to ${ownerName}`}
            placeholderTextColor="rgba(255,255,255,0.6)"
            style={styles.replyInput}
            autoFocus
            onBlur={() => { setReplying(false); setPaused(false); }}
          />
          <Pressable onPress={onReplySend} hitSlop={8} disabled={!replyText.trim()}>
            <Ionicons name="send" size={22} color={replyText.trim() ? theme.tint : 'rgba(255,255,255,0.5)'} />
          </Pressable>
        </View>
      ) : null}

      <ActionMenu
        visible={menu}
        options={[
          { label: 'Report', onPress: () => { if (currentUserId) reportUser(currentUserId, 'Inappropriate story').then(() => Alert.alert('Thanks', 'Reported.')); } },
          { label: 'Block', destructive: true, onPress: async () => { if (currentUserId) { await blockUser(currentUserId); router.back(); } } },
        ]}
        onClose={() => setMenu(false)}
      />

      {/* viewer list (own stories only, non-anonymous) */}
      {viewers ? (
        <Pressable style={styles.viewerBackdrop} onPress={() => { setViewers(null); setPaused(false); }}>
          <View style={[styles.viewerSheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 12 }]}>
            <ThemedText type="subtitle" style={{ padding: 14 }}>{viewers.length} {viewers.length === 1 ? 'view' : 'views'}</ThemedText>
            {viewers.map((v) => (
              <View key={v.viewer_id} style={styles.viewerRow}>
                {v.avatar_url ? <Image source={{ uri: v.avatar_url }} style={styles.viewerAvatar} contentFit="cover" /> : <View style={[styles.viewerAvatar, { backgroundColor: theme.backgroundSelected }]} />}
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{v.display_name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">@{v.handle}</ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">{formatRelative(v.viewed_at)}</ThemedText>
              </View>
            ))}
            {viewers.length === 0 ? <ThemedText type="small" themeColor="textSecondary" style={{ padding: 14 }}>No views yet.</ThemedText> : null}
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlayWrap: { position: 'absolute', top: '45%', left: 20, right: 20, alignItems: 'center' },
  overlayText: { color: '#fff', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  bars: { position: 'absolute', left: 8, right: 8, flexDirection: 'row', gap: 3 },
  barTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  barFill: { height: 3, backgroundColor: '#fff' },
  header: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAvatar: { width: 32, height: 32, borderRadius: 16 },
  footerSelf: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999 },
  replyPrompt: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 999 },
  replyBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 10, backgroundColor: 'rgba(0,0,0,0.85)' },
  replyInput: { flex: 1, color: '#fff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 15 },
  viewerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  viewerSheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: H * 0.6 },
  viewerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  viewerAvatar: { width: 40, height: 40, borderRadius: 20 },
});

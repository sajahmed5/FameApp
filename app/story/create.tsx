import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { createStory } from '@/lib/stories';
import { uploadToPipeline } from '@/lib/upload';

export default function StoryCreateScreen() {
  const { uri, type } = useLocalSearchParams<{ uri: string; type: 'image' | 'video' }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [overlay, setOverlay] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const player = useVideoPlayer(type === 'video' ? uri : null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  const share = async () => {
    if (busy || !uri) return;
    setBusy(true);
    try {
      // Same upload pipeline as posts: EXIF strip, adult + CSAM scan, transcode.
      const result = await uploadToPipeline(
        { uri, type: type ?? 'image', mime: type === 'video' ? 'video/mp4' : 'image/jpeg' },
        () => {},
      );
      if (result.moderation_status === 'flagged' || result.moderation_status === 'removed') {
        Alert.alert('Blocked', 'That media was blocked by our safety check.');
        setBusy(false);
        return;
      }
      await createStory(result.media_url, result.thumbnail_url, result.media_type, result.duration_seconds, overlay.trim() || undefined);
      router.dismissAll?.();
      router.replace('/following');
    } catch (e) {
      setBusy(false);
      Alert.alert(
        'Could not post',
        e instanceof Error && e.message.includes('video_too_long') ? 'Videos must be 15 seconds or less.' : 'Please try again.',
      );
    }
  };

  return (
    <View style={styles.container}>
      {type === 'video' ? (
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} pointerEvents="none" />
      ) : (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
      )}

      {/* overlay preview */}
      {overlay.trim() && !editing ? (
        <Pressable style={styles.overlayWrap} onPress={() => setEditing(true)}>
          <ThemedText type="title" style={styles.overlayText}>{overlay}</ThemedText>
        </Pressable>
      ) : null}

      {editing ? (
        <View style={styles.editLayer}>
          <TextInput
            value={overlay}
            onChangeText={setOverlay}
            placeholder="Type text or emoji…"
            placeholderTextColor="rgba(255,255,255,0.6)"
            style={styles.editInput}
            autoFocus
            multiline
            onBlur={() => setEditing(false)}
          />
          <Pressable onPress={() => setEditing(false)} style={styles.doneBtn}>
            <ThemedText type="smallBold" style={{ color: '#fff' }}>Done</ThemedText>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.top, { top: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="close" size={28} color="#fff" /></Pressable>
        {/* Images arrive already edited (text burned in via the shared editor). Video
            bypasses the editor, so it keeps the lightweight view-time text overlay. */}
        {type === 'video' ? (
          <Pressable onPress={() => setEditing(true)} hitSlop={10} style={styles.aa}>
            <ThemedText type="smallBold" style={{ color: '#fff' }}>Aa</ThemedText>
          </Pressable>
        ) : null}
      </View>

      <Pressable onPress={share} disabled={busy} style={[styles.share, { bottom: insets.bottom + 16, backgroundColor: theme.tint }]}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <ThemedText type="smallBold" style={{ color: '#fff' }}>Add to story</ThemedText>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlayWrap: { position: 'absolute', top: '45%', left: 20, right: 20, alignItems: 'center' },
  overlayText: { color: '#fff', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  editLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', paddingHorizontal: 24 },
  editInput: { color: '#fff', fontSize: 26, fontWeight: '700', textAlign: 'center', maxHeight: 200 },
  doneBtn: { position: 'absolute', top: 60, right: 20, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)' },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aa: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  share: { position: 'absolute', right: 16, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999 },
});

import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/constants/config';
import { useAuth } from '@/lib/auth-context';
import type { PickedMedia } from '@/lib/upload';
import { useUpload } from '@/lib/upload-manager';

const MAX_VIDEO_MS = 60_000;

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { begin } = useUpload();
  const { dest } = useLocalSearchParams<{ dest?: string }>();

  // Capture destination: a normal post, or a 24h story (entered from the rail's +).
  const [target, setTarget] = useState<'post' | 'story'>('post');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync target to the route param
    setTarget(dest === 'story' ? 'story' : 'post');
  }, [dest]);

  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recProgress, setRecProgress] = useState(0); // 0..1 of the 60s cap
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStart = useRef<number>(0);

  // The camera preview goes black after the app is backgrounded (or the tab is left) unless
  // CameraView is remounted. Mount it only while the screen is focused AND the app is in the
  // foreground, so returning to the camera always shows a live preview.
  const [isFocused, setIsFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  const cameraLive = isFocused && appActive;

  const startNewComposition = useCallback(
    (media: PickedMedia) => {
      // Images go through the shared editor first (filters/text/stickers/draw), which
      // burns edits in and then continues to the post or story flow. Video bypasses the
      // editor — burning overlays into every frame is out of scope for this path.
      // On web the editor (Skia/CanvasKit) isn't wired up, so images skip straight to the
      // post/story flow; capture + upload still work, just without in-app editing.
      if (media.type === 'image' && Platform.OS !== 'web') {
        router.push({
          pathname: '/edit',
          params: {
            uri: media.uri,
            target,
            ...(media.width != null ? { w: String(media.width) } : {}),
            ...(media.height != null ? { h: String(media.height) } : {}),
          },
        });
        return;
      }
      if (target === 'story') {
        router.push({ pathname: '/story/create', params: { uri: media.uri, type: media.type } });
        return;
      }
      begin(media, { visibility: profile?.is_private ? 'private' : 'public' });
      router.push('/compose');
    },
    [target, begin, profile?.is_private, router],
  );

  // Multiple gallery picks → carousel post. Skips the single-image editor and goes
  // straight to compose; the first selection is the cover.
  const startMultiComposition = useCallback(
    (items: PickedMedia[]) => {
      begin(items[0], { visibility: profile?.is_private ? 'private' : 'public' }, items.slice(1));
      router.push('/compose');
    },
    [begin, profile?.is_private, router],
  );

  const clearTimer = useCallback(() => {
    if (recTimer.current) clearInterval(recTimer.current);
    recTimer.current = null;
    setRecProgress(0);
  }, []);
  useEffect(() => () => clearTimer(), [clearTimer]);

  const capturePhoto = useCallback(async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        startNewComposition({
          uri: photo.uri,
          type: 'image',
          mime: 'image/jpeg',
          fileName: 'capture.jpg',
          width: photo.width,
          height: photo.height,
        });
      }
    } finally {
      setBusy(false);
    }
  }, [busy, startNewComposition]);

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || recording) return;
    if (!micPerm?.granted) await requestMic();
    // Stories cap video at 15s; posts at 60s.
    const videoMaxMs = target === 'story' ? 15_000 : MAX_VIDEO_MS;
    setRecording(true);
    recStart.current = Date.now();
    recTimer.current = setInterval(() => {
      setRecProgress(Math.min(1, (Date.now() - recStart.current) / videoMaxMs));
    }, 100);
    try {
      // maxDuration is the HARD cap — recording stops itself at the limit.
      const video = await cameraRef.current.recordAsync({ maxDuration: videoMaxMs / 1000 });
      if (video?.uri) {
        startNewComposition({
          uri: video.uri,
          type: 'video',
          mime: 'video/mp4',
          fileName: 'capture.mp4',
        });
      } else if (Platform.OS === 'web') {
        Alert.alert(
          'Video',
          "In-app recording isn't supported in this browser. Tap the gallery icon (bottom-left) to upload a video from your device instead.",
        );
      }
    } catch {
      Alert.alert(
        'Video',
        Platform.OS === 'web'
          ? "In-app recording isn't supported in this browser. Tap the gallery icon (bottom-left) to upload a video instead."
          : "Couldn't record video. Please try again.",
      );
    } finally {
      setRecording(false);
      clearTimer();
    }
  }, [recording, micPerm?.granted, requestMic, startNewComposition, clearTimer, target]);

  const stopRecording = useCallback(() => {
    if (recording) cameraRef.current?.stopRecording();
  }, [recording]);

  // ---- Permission gate: explain BEFORE requesting; offer Settings if blocked. ----
  if (!camPerm) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={BRAND.accent} />
      </View>
    );
  }
  if (!camPerm.granted) {
    const blocked = !camPerm.canAskAgain;
    return (
      <View style={[styles.center, styles.explain]}>
        <Ionicons name="camera-outline" size={56} color="#fff" />
        <ThemedText type="subtitle" style={styles.explainText}>
          Camera access
        </ThemedText>
        <ThemedText type="default" style={styles.explainBody}>
          Phixr needs your camera to capture photos and videos to post. We only use it while
          you&apos;re on this screen.
        </ThemedText>
        {blocked ? (
          <>
            <ThemedText type="small" style={styles.explainBody}>
              Camera access is turned off. Enable it in Settings to continue.
            </ThemedText>
            <Button title="Open Settings" onPress={() => Linking.openSettings()} />
          </>
        ) : (
          <Button
            title="Enable camera"
            onPress={async () => {
              await requestCam();
              await requestMic();
            }}
          />
        )}
        <ThemedText type="small" style={styles.explainBody}>
          Or pick something you&apos;ve already shot:
        </ThemedText>
        <Button
          title="Choose from library"
          variant="secondary"
          onPress={() => pickFromLibrary(startNewComposition, startMultiComposition, target === 'post', setBusy)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {cameraLive ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flash}
          mode={mode}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
      )}

      {/* Top controls */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <IconButton name="close" onPress={() => router.back()} />
        <View style={styles.destToggle}>
          {(['post', 'story'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => !recording && setTarget(t)}
              style={[styles.destTab, target === t && { backgroundColor: 'rgba(255,255,255,0.9)' }]}>
              <ThemedText type="small" style={{ color: target === t ? '#000' : '#fff', fontWeight: '700' }}>
                {t === 'post' ? 'Post' : 'Story'}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <View style={styles.topRight}>
          <IconButton
            name={flash === 'on' ? 'flash' : 'flash-off'}
            onPress={() => setFlash((f) => (f === 'on' ? 'off' : 'on'))}
          />
          <IconButton
            name="camera-reverse-outline"
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          />
        </View>
      </View>

      {recording ? (
        <View style={[styles.recPill, { top: insets.top + 60 }]}>
          <View style={styles.recDot} />
          <ThemedText type="small" style={styles.recText}>
            {Math.ceil((recProgress * (target === 'story' ? 15_000 : MAX_VIDEO_MS)) / 1000)}s /{' '}
            {target === 'story' ? 15 : 60}s
          </ThemedText>
        </View>
      ) : null}

      {/* Bottom controls */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.modeRow}>
          <ModeTab
            label="Photo"
            active={mode === 'picture'}
            onPress={() => !recording && setMode('picture')}
          />
          <ModeTab
            label="Video"
            active={mode === 'video'}
            onPress={() => !recording && setMode('video')}
          />
        </View>
        <View style={styles.shutterRow}>
          <IconButton
            name="images-outline"
            onPress={() => pickFromLibrary(startNewComposition, startMultiComposition, target === 'post', setBusy)}
            disabled={recording}
          />
          <ShutterButton
            mode={mode}
            recording={recording}
            progress={recProgress}
            busy={busy}
            onPressPhoto={capturePhoto}
            onStartVideo={startRecording}
            onStopVideo={stopRecording}
          />
          <View style={styles.spacer} />
        </View>
        <ThemedText type="small" style={styles.hint}>
          {mode === 'video'
            ? recording
              ? 'Tap to stop'
              : 'Tap to record · 60s max'
            : 'Tap to capture'}
        </ThemedText>
      </View>
    </View>
  );
}

async function pickFromLibrary(
  onPicked: (m: PickedMedia) => void,
  onPickedMulti: (items: PickedMedia[]) => void,
  allowMultiple: boolean,
  setBusy: (b: boolean) => void,
) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    if (!perm.canAskAgain) Linking.openSettings();
    return;
  }
  setBusy(true);
  try {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.9,
      videoMaxDuration: 60,
      // Carousel: pick up to 5 for a post; other targets stay single-select.
      allowsMultipleSelection: allowMultiple,
      selectionLimit: 5,
      orderedSelection: true,
    });
    if (res.canceled || !res.assets?.length) return;
    const toPicked = (a: (typeof res.assets)[number]): PickedMedia => {
      const type = a.type === 'video' ? 'video' : 'image';
      return {
        uri: a.uri,
        type,
        mime: a.mimeType ?? (type === 'video' ? 'video/mp4' : 'image/jpeg'),
        fileName: a.fileName ?? undefined,
        width: a.width,
        height: a.height,
      };
    };
    if (res.assets.length > 1) {
      onPickedMulti(res.assets.slice(0, 5).map(toPicked));
      return;
    }
    onPicked(toPicked(res.assets[0]));
  } finally {
    setBusy(false);
  }
}

function IconButton({
  name,
  onPress,
  disabled,
}: {
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={10}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Ionicons name={name} size={26} color="#fff" />
    </Pressable>
  );
}

function ModeTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}>
      <ThemedText type="smallBold" style={{ color: active ? '#fff' : 'rgba(255,255,255,0.55)' }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function ShutterButton({
  mode,
  recording,
  progress,
  busy,
  onPressPhoto,
  onStartVideo,
  onStopVideo,
}: {
  mode: 'picture' | 'video';
  recording: boolean;
  progress: number;
  busy: boolean;
  onPressPhoto: () => void;
  onStartVideo: () => void;
  onStopVideo: () => void;
}) {
  const isVideo = mode === 'video';
  // Tap to toggle recording — press-and-hold doesn't work on the web app (and is
  // fiddly on touch). Tap once to start, tap again to stop.
  const onPress = isVideo ? (recording ? onStopVideo : onStartVideo) : onPressPhoto;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        isVideo ? (recording ? 'Stop recording' : 'Start recording') : 'Capture photo'
      }
      onPress={onPress}
      disabled={busy}
      style={styles.shutterOuter}>
      <View style={[styles.shutterRing, recording && styles.shutterRingRecording]} />
      <View
        style={[
          styles.shutterInner,
          isVideo && styles.shutterInnerVideo,
          recording && styles.shutterInnerRecording,
        ]}
      />
      {recording ? <View style={[styles.progressArc, { opacity: 0.3 + progress * 0.7 }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  explain: { padding: 32, gap: 14 },
  explainText: { color: '#fff', textAlign: 'center' },
  explainBody: { color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topRight: { flexDirection: 'row', gap: 8 },
  destToggle: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 999, padding: 3 },
  destTab: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  recPill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff4d4f' },
  recText: { color: '#fff' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', gap: 16 },
  modeRow: { flexDirection: 'row', gap: 24 },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '80%',
  },
  spacer: { width: 44 },
  shutterOuter: { width: 78, height: 78, alignItems: 'center', justifyContent: 'center' },
  shutterRing: {
    position: 'absolute',
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#fff',
  },
  shutterRingRecording: { borderColor: '#ff4d4f' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  shutterInnerVideo: { backgroundColor: '#ff4d4f' },
  shutterInnerRecording: { width: 32, height: 32, borderRadius: 8 },
  progressArc: {
    position: 'absolute',
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: 'rgba(255,77,79,0.6)',
  },
  hint: { color: 'rgba(255,255,255,0.7)' },
});

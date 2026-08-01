import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';

import { MediaEditor } from '@/components/media-editor/media-editor';
import { useAuth } from '@/lib/auth-context';
import type { ExportedMedia } from '@/lib/media-editor';
import type { PickedMedia } from '@/lib/upload';
import type { VideoOverlay } from '@/lib/video-overlays';
import { useUpload } from '@/lib/upload-manager';

/**
 * Shared media-editor step for images, used by BOTH the post and story flows (via the
 * `target` param). On Done the burned-in JPEG replaces the original and continues to the
 * matching flow; the original capture is never uploaded or retained.
 */
export default function EditScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { begin } = useUpload();
  const { uri, target, type, w, h } = useLocalSearchParams<{
    uri: string;
    target?: string;
    type?: string;
    w?: string;
    h?: string;
  }>();
  const isVideo = type === 'video';
  const aspect = w && h && Number(h) > 0 ? Number(w) / Number(h) : undefined;

  // Video Done: the ORIGINAL file uploads untouched; the overlays ride along as data
  // and are drawn over the player at playback.
  const onDoneVideo = useCallback(
    (overlays: VideoOverlay[]) => {
      const picked: PickedMedia = {
        uri,
        type: 'video',
        mime: 'video/mp4',
        fileName: 'capture.mp4',
        ...(aspect && w ? { width: Number(w), height: Number(h) } : {}),
      };
      begin(picked, { visibility: profile?.is_private ? 'private' : 'public' }, [], overlays);
      router.replace('/compose');
    },
    [uri, aspect, w, h, begin, profile?.is_private, router],
  );

  const onDone = useCallback(
    (media: ExportedMedia) => {
      const picked: PickedMedia = {
        uri: media.uri,
        type: 'image',
        mime: 'image/jpeg',
        fileName: 'edited.jpg',
        width: media.width,
        height: media.height,
      };
      if (target === 'story') {
        router.replace({ pathname: '/story/create', params: { uri: media.uri, type: 'image' } });
        return;
      }
      begin(picked, { visibility: profile?.is_private ? 'private' : 'public' });
      router.replace('/compose');
    },
    [target, begin, profile?.is_private, router],
  );

  // The editor is Skia-based and isn't wired for web (CanvasKit), so on web we pass the
  // original image straight through to the post/story flow — capture/upload still work,
  // just without in-app editing. Belt-and-suspenders: the camera also skips this route on
  // web, so this only fires if something reaches /edit anyway (e.g. a cached bundle).
  useEffect(() => {
    if (Platform.OS !== 'web' || !uri) return;
    if (isVideo) {
      const picked: PickedMedia = { uri, type: 'video', mime: 'video/mp4', fileName: 'upload.mp4' };
      begin(picked, { visibility: profile?.is_private ? 'private' : 'public' });
      router.replace('/compose');
      return;
    }
    if (target === 'story') {
      router.replace({ pathname: '/story/create', params: { uri, type: 'image' } });
      return;
    }
    const picked: PickedMedia = { uri, type: 'image', mime: 'image/jpeg', fileName: 'upload.jpg' };
    begin(picked, { visibility: profile?.is_private ? 'private' : 'public' });
    router.replace('/compose');
  }, [uri, target, isVideo, begin, profile?.is_private, router]);

  if (Platform.OS === 'web') return null;

  return (
    <MediaEditor
      uri={uri}
      mediaType={isVideo ? 'video' : 'image'}
      mediaAspect={aspect}
      onDone={onDone}
      onDoneVideo={onDoneVideo}
      onCancel={() => router.back()}
    />
  );
}

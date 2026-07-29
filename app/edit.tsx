import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';

import { MediaEditor } from '@/components/media-editor/media-editor';
import { useAuth } from '@/lib/auth-context';
import type { ExportedMedia } from '@/lib/media-editor';
import type { PickedMedia } from '@/lib/upload';
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
  const { uri, target } = useLocalSearchParams<{ uri: string; target?: string }>();

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
    if (target === 'story') {
      router.replace({ pathname: '/story/create', params: { uri, type: 'image' } });
      return;
    }
    const picked: PickedMedia = { uri, type: 'image', mime: 'image/jpeg', fileName: 'upload.jpg' };
    begin(picked, { visibility: profile?.is_private ? 'private' : 'public' });
    router.replace('/compose');
  }, [uri, target, begin, profile?.is_private, router]);

  if (Platform.OS === 'web') return null;

  return <MediaEditor uri={uri} onDone={onDone} onCancel={() => router.back()} />;
}

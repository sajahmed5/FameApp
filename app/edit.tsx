import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

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

  return <MediaEditor uri={uri} onDone={onDone} onCancel={() => router.back()} />;
}

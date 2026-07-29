/**
 * Burn-in export for the media editor. Snapshots the composed edit view (base image with
 * its GPU filter + drawing + text/sticker overlays) to a single flattened JPEG via Skia's
 * `makeImageFromView`, writes it to a cache file, and returns the new URI + dimensions.
 *
 * The exported JPEG is a freshly-encoded raster with NO EXIF/metadata by construction, and
 * the upload pipeline re-encodes + verifies the strip again server-side. The caller feeds
 * this URI to the pipeline in place of the original; the original is never uploaded or
 * retained (see the editor screen).
 */
import { ImageFormat, makeImageFromView } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import type { RefObject } from 'react';
import type { View } from 'react-native';

export type ExportedMedia = { uri: string; width: number; height: number };

export async function exportEditedImage(
  viewRef: RefObject<View | null>,
  id: string,
): Promise<ExportedMedia> {
  const image = await makeImageFromView(viewRef);
  if (!image) throw new Error('Could not export the edited image.');
  const bytes = image.encodeToBytes(ImageFormat.JPEG, 92);
  const file = new File(Paths.cache, `fame-edit-${id}.jpg`);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  const result = { uri: file.uri, width: image.width(), height: image.height() };
  image.dispose();
  return result;
}

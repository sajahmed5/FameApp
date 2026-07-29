import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '@/lib/supabase';
import { findOrCreateTag } from '@/lib/tags';

// The pipeline's in-edge decode budget (see media-pipeline config). Downscale images
// past this before upload so full-res phone photos aren't rejected. Note: re-encoding
// here drops EXIF, so GPS suggestions are only available for images already within
// budget; larger images upload successfully but without a location suggestion.
const CLIENT_MAX_EDGE = 2048; // longest edge → ≤ ~4 MP for typical aspect ratios
const CLIENT_MAX_PIXELS = 4_000_000;

// Shape returned by the media-pipeline Edge Function.
export type TagSuggestion = {
  name: string;
  confidence?: number;
  source: 'vision' | 'geo';
  tag_id: string | null;
};

export type PipelineResult = {
  media_type: 'image' | 'video';
  media_url: string; // object key in the private `media` bucket
  thumbnail_url: string;
  moderation_status: 'approved' | 'flagged' | 'pending' | 'removed';
  width: number;
  height: number;
  duration_seconds?: number;
  suggestions: {
    gps: { latitude: number; longitude: number } | null;
    taken_at: string | null;
    location_cell: string | null;
    labels: TagSuggestion[];
    places: TagSuggestion[];
  };
};

export type PickedMedia = {
  uri: string;
  type: 'image' | 'video';
  mime: string;
  fileName?: string;
  width?: number;
  height?: number;
};

/**
 * Downscale an oversized image to fit the pipeline's decode budget. Returns a new
 * PickedMedia pointing at the resized JPEG (EXIF is dropped by the re-encode). Images
 * already within budget, and all videos, pass through untouched.
 */
export async function prepareForUpload(media: PickedMedia): Promise<PickedMedia> {
  if (media.type !== 'image') return media;
  const pixels = (media.width ?? 0) * (media.height ?? 0);
  const longest = Math.max(media.width ?? 0, media.height ?? 0);
  if (pixels && pixels <= CLIENT_MAX_PIXELS && longest <= CLIENT_MAX_EDGE) return media;

  const ctx = ImageManipulator.ImageManipulator.manipulate(media.uri);
  ctx.resize(
    media.width && media.height && media.width >= media.height
      ? { width: CLIENT_MAX_EDGE }
      : { height: CLIENT_MAX_EDGE },
  );
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
  return { ...media, uri: out.uri, mime: 'image/jpeg', fileName: 'upload.jpg' };
}

// A rejection by the adult-content scan is a normal outcome, not a thrown error.
export class UploadRejected extends Error {}
// Everything else (network, 5xx, timeout) is retryable.
export class UploadFailed extends Error {}

/**
 * Upload media to the processing pipeline via XHR so we get real upload progress
 * (fetch gives none). Resolves with the pipeline result, throws UploadRejected for a
 * content-scan rejection, or UploadFailed for anything retryable.
 */
export function uploadToPipeline(
  media: PickedMedia,
  onProgress: (fraction: number) => void,
  signal?: { aborted: boolean; onAbort: (cb: () => void) => void },
): Promise<PipelineResult> {
  return new Promise(async (resolve, reject) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return reject(new UploadFailed('Not signed in.'));

    let prepared: PickedMedia;
    try {
      prepared = await prepareForUpload(media);
    } catch {
      return reject(new UploadFailed('Could not prepare the image for upload.'));
    }

    const filename = prepared.fileName ?? `upload.${prepared.type === 'video' ? 'mp4' : 'jpg'}`;
    const form = new FormData();
    if (Platform.OS === 'web') {
      // Browser FormData needs a real Blob/File — the RN {uri,name,type} object doesn't
      // carry bytes. Fetch the picked blob:/data: URL into a Blob and append that.
      try {
        const blob = await fetch(prepared.uri).then((r) => r.blob());
        form.append('file', blob, filename);
      } catch {
        return reject(new UploadFailed('Could not read the selected file.'));
      }
    } else {
      // React Native FormData file part.
      form.append('file', {
        uri: prepared.uri,
        name: filename,
        type: prepared.mime,
      } as unknown as Blob);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/functions/v1/media-pipeline`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(0.99, e.loaded / e.total));
    };
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // fall through to status handling
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve(body as unknown as PipelineResult);
      } else if (xhr.status === 422 && body.error === 'rejected') {
        reject(new UploadRejected(String(body.reason ?? 'content_policy')));
      } else if (xhr.status === 413) {
        reject(new UploadFailed(String(body.message ?? 'That file is too large to process.')));
      } else {
        reject(new UploadFailed(String(body.message ?? `Upload failed (${xhr.status}).`)));
      }
    };
    xhr.onerror = () => reject(new UploadFailed('Network error during upload.'));
    xhr.ontimeout = () => reject(new UploadFailed('Upload timed out.'));
    xhr.timeout = 120000;
    signal?.onAbort(() => xhr.abort());
    xhr.send(form);
  });
}

export type CreatePostInput = {
  result: PipelineResult;
  caption: string;
  altText: string;
  visibility: 'public' | 'private';
  attachLocation: boolean;
  // Tags the user confirmed, split by provenance. Names are raw; resolved here.
  tags: { name: string; source: 'user' | 'vision' | 'geo' }[];
};

/**
 * Persist the post the pipeline already processed: insert the row with the media keys,
 * resolve/attach tags with their provenance, and store the coarse location cell only if
 * the user opted in. The post's moderation_status is NOT set here — the client can't set
 * it; a BEFORE-INSERT trigger stamps the pipeline's verdict (see the
 * post_moderation_verdict migration). Returns the new post id.
 */
export async function createPost(input: CreatePostInput): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('Not signed in.');

  const { result } = input;
  const { data: post, error } = await supabase
    .from('posts')
    .insert({
      user_id: uid,
      media_url: result.media_url,
      thumbnail_url: result.thumbnail_url,
      media_type: result.media_type,
      caption: input.caption.trim() || null,
      alt_text: input.altText.trim() || null,
      visibility: input.visibility,
      // Only the coarse cell, only if opted in — never raw coordinates.
      location_cell: input.attachLocation ? (result.suggestions.location_cell ?? null) : null,
    })
    .select('id')
    .single();
  if (error) throw error;
  const postId = (post as { id: string }).id;

  // Resolve tag names → ids (find-or-create), then attach with provenance.
  const resolved = await Promise.all(
    input.tags.map(async (t) => ({ tag: await findOrCreateTag(t.name), source: t.source })),
  );
  const rows = dedupeByTag(resolved).map((r) => ({
    post_id: postId,
    tag_id: r.tag.id,
    source: r.source,
  }));
  if (rows.length) {
    const { error: tagErr } = await supabase.from('post_tags').insert(rows);
    if (tagErr) throw tagErr;
  }
  return postId;
}

function dedupeByTag(items: { tag: { id: string }; source: 'user' | 'vision' | 'geo' }[]) {
  const seen = new Set<string>();
  const out: typeof items = [];
  for (const it of items) {
    if (seen.has(it.tag.id)) continue;
    seen.add(it.tag.id);
    out.push(it);
  }
  return out;
}

// ============================================================================
// media-pipeline — Supabase Edge Function.
//
// Processes an uploaded media file through the MANDATED pipeline order before
// anything is persisted or served:
//   1. Accept upload → PRIVATE staging bucket (nothing public before step 6)
//   2. EXIF READ   (GPS + timestamp, in-memory, for suggestion; not persisted)
//   3. EXIF STRIP  (re-encode; then VERIFY the output is clean — fail-closed)
//   4. ADULT SCAN  (Google Vision SafeSearch; reject / flag / approve)
//   5. CSAM SCAN   (integration point; STUB — NOT PRODUCTION READY)
//   6. TRANSCODE + STORE → serving bucket (images inline; video via worker)
//   7. Return urls, moderation_status, and GPS/label/place tag suggestions.
//
// A failure at any step removes everything written so far — nothing orphaned.
// ============================================================================
import { config } from './config.ts';
import { detectMedia } from './content-type.ts';
import { readExif, readPixelDimensions } from './exif.ts';
import { readDimensions } from './dimensions.ts';
import { processImage, verifyStripped } from './image.ts';
import { scanAndLabel, type LabelSuggestion } from './vision.ts';
import { stubScanner } from './csam.ts';
import { coarseLocationCell, reverseGeocode } from './geo.ts';
import { externalTranscoder, probeDurationSeconds } from './video.ts';
import {
  downloadObject, putObject, recordVerdict, removeObjects, serviceClient, SERVING_BUCKET,
  signedUrl, STAGING_BUCKET, userClient,
} from './storage.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // ---- SECURITY: authenticate the caller. Unauthenticated → reject. ----
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
  const jwt = auth.slice(7);
  const uclient = userClient(jwt);
  const { data: userData, error: authErr } = await uclient.auth.getUser();
  const user = userData?.user;
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);

  // ---- SECURITY: per-user rate limit (recorded under the caller's identity). ----
  const { data: allowed, error: rlErr } = await uclient.rpc('claim_media_upload_slot', {
    _max: config.limits.uploadsPerHour,
    _window_seconds: 3600,
  });
  if (rlErr) return json({ error: 'rate_limit_check_failed' }, 500);
  if (!allowed) return json({ error: 'rate_limited', message: 'Too many uploads. Try again later.' }, 429);

  // ---- Read the file from multipart form-data. ----
  let bytes: Uint8Array;
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'no_file' }, 400);
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return json({ error: 'bad_request', message: 'Expected multipart/form-data with a "file" field.' }, 400);
  }
  if (bytes.length === 0) return json({ error: 'empty_file' }, 400);

  // ---- SECURITY: validate type by CONTENT, not extension/client MIME. ----
  const detected = detectMedia(bytes);
  if (!detected.ok) return json({ error: 'unsupported_type', message: detected.reason }, 415);

  // ---- SECURITY: server-side size limits (by kind). ----
  const maxBytes = detected.kind === 'video' ? config.limits.maxVideoBytes : config.limits.maxImageBytes;
  if (bytes.length > maxBytes) {
    return json({ error: 'too_large', message: `Max ${Math.round(maxBytes / 1048576)} MB for ${detected.kind}.` }, 413);
  }

  const svc = serviceClient();
  const mediaId = crypto.randomUUID();
  const owner = user.id;
  // Cleanup ledger — every object written is tracked so a later failure removes it.
  const written: { bucket: string; path: string }[] = [];
  const track = (bucket: string, path: string) => written.push({ bucket, path });
  const cleanupAll = async () => {
    for (const bucket of [STAGING_BUCKET, SERVING_BUCKET]) {
      const paths = written.filter((w) => w.bucket === bucket).map((w) => w.path);
      await removeObjects(svc, bucket, paths);
    }
  };

  try {
    // ===== STEP 1: accept upload → PRIVATE staging =====
    const stagingPath = `${owner}/${mediaId}.orig`;
    await putObject(svc, STAGING_BUCKET, stagingPath, bytes, detected.mime);
    track(STAGING_BUCKET, stagingPath);

    // ===== STEP 2: EXIF READ (in-memory, for suggestions only) =====
    const exif = await readExif(bytes);

    if (detected.kind === 'video') {
      const result = await handleVideo({ svc, owner, mediaId, bytes, exif, stagingPath, track, cleanupAll });
      return result;
    }

    // Guard: reject over-budget images BEFORE decode (decoding a full-res phone
    // photo to RGBA would exhaust the isolate's memory). Header parse is reliable
    // even without EXIF; EXIF is the fallback.
    const dims = readDimensions(bytes, detected.mime) ?? await readPixelDimensions(bytes);
    if (dims && (dims.width * dims.height) / 1e6 > config.limits.maxImageMegapixels) {
      await cleanupAll();
      const mp = ((dims.width * dims.height) / 1e6).toFixed(1);
      return json({
        error: 'image_too_large',
        message: `Image is ${mp} MP; the in-function limit is ${config.limits.maxImageMegapixels} MP. ` +
          'Downscale before upload (the capture client should do this).',
      }, 413);
    }

    // ===== STEP 3: EXIF STRIP (re-encode) + VERIFY =====
    const processed = await processImage(bytes, detected.mime);
    await verifyStripped(processed.display); // throws (→ cleanup) if anything survived
    await verifyStripped(processed.thumbnail);

    // ===== STEP 4: ADULT SCAN (+ labels, one call) — on the stripped image =====
    const vision = await scanAndLabel(processed.display);
    if (vision.decision === 'reject') {
      await cleanupAll();
      return json({ error: 'rejected', reason: vision.reason, moderation_status: 'removed' }, 422);
    }

    // ===== STEP 5: CSAM SCAN (STUB — NOT PRODUCTION READY) =====
    const csam = await stubScanner.scan(processed.display, { userId: owner, mime: 'image/jpeg' });
    if (csam.status === 'reject') {
      await cleanupAll();
      return json({ error: 'rejected', reason: 'content_policy', case_ref: csam.caseRef }, 422);
    }

    const moderationStatus = vision.decision === 'flag' ? 'flagged' : 'approved';

    // ===== STEP 6: STORE to serving bucket (first serving write), drop staging =====
    const mediaPath = `${owner}/${mediaId}.${processed.ext}`;
    const thumbPath = `${owner}/${mediaId}_thumb.${processed.ext}`;
    await putObject(svc, SERVING_BUCKET, mediaPath, processed.display, processed.mime);
    track(SERVING_BUCKET, mediaPath);
    await putObject(svc, SERVING_BUCKET, thumbPath, processed.thumbnail, processed.mime);
    track(SERVING_BUCKET, thumbPath);
    // Record the verdict so the post the client creates inherits this status.
    await recordVerdict(svc, mediaPath, owner, moderationStatus);
    await removeObjects(svc, STAGING_BUCKET, [stagingPath]); // staging no longer needed

    // ===== STEP 7: build suggestions + response =====
    const suggestions = await buildSuggestions(svc, exif, vision.labels);
    return json({
      media_type: 'image',
      media_url: mediaPath, // object key; client stores this on the post
      thumbnail_url: thumbPath,
      moderation_status: moderationStatus,
      width: processed.width,
      height: processed.height,
      preview: {
        media: await signedUrl(svc, SERVING_BUCKET, mediaPath),
        thumbnail: await signedUrl(svc, SERVING_BUCKET, thumbPath),
      },
      suggestions,
    });
  } catch (e) {
    await cleanupAll();
    console.error('[media-pipeline] failed:', e);
    return json({ error: 'processing_failed', message: String(e instanceof Error ? e.message : e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Video path — steps 3–6 happen in an external worker (see video.ts). In-edge
// we enforce the duration cap, then hand off. If no worker is configured we
// clean up and return a clear "not configured" error (never orphan the file).
// ---------------------------------------------------------------------------
async function handleVideo(args: {
  svc: SupabaseClient; owner: string; mediaId: string; bytes: Uint8Array;
  exif: Awaited<ReturnType<typeof readExif>>; stagingPath: string;
  track: (b: string, p: string) => void; cleanupAll: () => Promise<void>;
}): Promise<Response> {
  const { svc, owner, mediaId, bytes, exif, cleanupAll } = args;

  // Duration cap enforced server-side (probe, no decode).
  const dur = probeDurationSeconds(bytes);
  if (dur !== null && dur > config.limits.maxVideoSeconds) {
    await cleanupAll();
    return json({ error: 'too_long', message: `Video exceeds ${config.limits.maxVideoSeconds}s.` }, 413);
  }

  const transcoder = externalTranscoder();
  if (!transcoder) {
    // No worker → we cannot transcode/scan frames in-edge. Fail cleanly.
    await cleanupAll();
    return json({
      error: 'video_not_configured',
      message: 'Video transcoding is not configured on this deployment (set TRANSCODER_URL). ' +
        'See supabase/functions/media-pipeline/video.ts and scripts/transcode-worker/.',
    }, 501);
  }

  try {
    // Worker: cap 60s, H.264 mp4, poster frame, STRIP metadata, write to serving.
    const t = await transcoder.transcode({ stagingPath: args.stagingPath, userId: owner, mediaId });
    args.track(SERVING_BUCKET, t.mediaPath);
    args.track(SERVING_BUCKET, t.posterPath);

    // STEP 4/5 for video run on the poster frame the worker produced.
    const poster = await downloadObject(svc, SERVING_BUCKET, t.posterPath);
    const vision = await scanAndLabel(poster);
    if (vision.decision === 'reject') {
      await cleanupAll();
      return json({ error: 'rejected', reason: vision.reason, moderation_status: 'removed' }, 422);
    }
    const csam = await stubScanner.scan(poster, { userId: owner, mime: 'image/jpeg' });
    if (csam.status === 'reject') {
      await cleanupAll();
      return json({ error: 'rejected', reason: 'content_policy' }, 422);
    }
    const moderationStatus = vision.decision === 'flag' ? 'flagged' : 'approved';
    await recordVerdict(svc, t.mediaPath, owner, moderationStatus);
    await removeObjects(svc, STAGING_BUCKET, [args.stagingPath]);

    const suggestions = await buildSuggestions(svc, exif, vision.labels);
    return json({
      media_type: 'video',
      media_url: t.mediaPath,
      thumbnail_url: t.posterPath,
      moderation_status: moderationStatus,
      width: t.width,
      height: t.height,
      duration_seconds: t.durationSeconds,
      preview: {
        media: await signedUrl(svc, SERVING_BUCKET, t.mediaPath),
        thumbnail: await signedUrl(svc, SERVING_BUCKET, t.posterPath),
      },
      suggestions,
    });
  } catch (e) {
    await cleanupAll();
    console.error('[media-pipeline] video failed:', e);
    return json({ error: 'processing_failed', message: String(e instanceof Error ? e.message : e) }, 500);
  }
}

// ---------------------------------------------------------------------------
// Build tag suggestions from GPS + vision labels. Labels/places are normalised
// and mapped to EXISTING tags where a match exists. Everything here is a
// SUGGESTION only — the client confirms before any tag is applied. Raw GPS is
// returned for suggestion; the coarse cell is what the client may store.
// ---------------------------------------------------------------------------
async function buildSuggestions(
  svc: SupabaseClient,
  exif: Awaited<ReturnType<typeof readExif>>,
  labels: LabelSuggestion[],
) {
  const places = exif.gps ? await reverseGeocode(exif.gps) : [];
  const names = [...new Set([...labels.map((l) => l.name), ...places])];

  // Map to existing tags in one query.
  const matched = new Map<string, string>();
  if (names.length) {
    const { data } = await svc.from('tags').select('id, name').in('name', names);
    for (const row of (data ?? []) as { id: string; name: string }[]) matched.set(row.name, row.id);
  }

  return {
    gps: exif.gps, // suggestion only — client discards after choosing
    taken_at: exif.takenAt,
    location_cell: exif.gps ? coarseLocationCell(exif.gps) : null, // coarse; stored only if user opts in
    labels: labels.map((l) => ({ name: l.name, confidence: l.confidence, source: 'vision', tag_id: matched.get(l.name) ?? null })),
    places: places.map((p) => ({ name: p, source: 'geo', tag_id: matched.get(p) ?? null })),
  };
}

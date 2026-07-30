// ============================================================================
// Phixr video transcode worker (Cloud Run).
//
// Implements the VideoTranscoder contract that supabase/functions/media-pipeline
// hands off to (see video.ts). It:
//   1. authenticates the call with the shared TRANSCODER_SECRET,
//   2. downloads the raw upload from the private `media-staging` bucket,
//   3. transcodes to H.264 MP4 — HARD 60s cap, longest edge ≤ 1080, metadata
//      STRIPPED (GPS/location atoms included), faststart, AAC audio,
//   4. extracts a poster frame,
//   5. uploads both to the private `media` (serving) bucket,
//   6. deletes the staging object,
//   7. returns { mediaPath, posterPath, durationSeconds, width, height }.
//
// The platform (media-pipeline) then scans the returned poster for adult/CSAM
// and sets moderation_status — this worker does not decide moderation.
// ============================================================================
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const exec = promisify(execFile);

const PORT = process.env.PORT || 8080;
const SECRET = process.env.TRANSCODER_SECRET || '';
const STAGING_BUCKET = 'media-staging';
const SERVING_BUCKET = 'media';
const MAX_SECONDS = Number(process.env.MAX_VIDEO_SECONDS || 60);
const MAX_EDGE = Number(process.env.MAX_VIDEO_EDGE || 1080);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function probe(file) {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json', file,
  ]);
  const j = JSON.parse(stdout);
  const s = j.streams?.[0] ?? {};
  return { width: Number(s.width) || 0, height: Number(s.height) || 0, duration: Number(j.format?.duration) || 0 };
}

async function transcode({ stagingPath, userId, mediaId }) {
  const dir = await mkdtemp(join(tmpdir(), 'fame-'));
  const inFile = join(dir, 'in');
  const outFile = join(dir, 'out.mp4');
  const posterFile = join(dir, 'poster.jpg');
  try {
    // 2. download raw upload
    const dl = await supabase.storage.from(STAGING_BUCKET).download(stagingPath);
    if (dl.error || !dl.data) throw new Error(`download failed: ${dl.error?.message}`);
    await writeFile(inFile, Buffer.from(await dl.data.arrayBuffer()));

    // 3. transcode: H.264, 60s cap, strip metadata, downscale, faststart
    await exec('ffmpeg', [
      '-y', '-i', inFile,
      '-t', String(MAX_SECONDS),
      '-map_metadata', '-1',
      '-vf', `scale='min(${MAX_EDGE},iw)':-2`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k',
      outFile,
    ], { maxBuffer: 1024 * 1024 * 16 });

    // 4. poster frame
    await exec('ffmpeg', ['-y', '-i', outFile, '-frames:v', '1', '-q:v', '3', posterFile]);

    const meta = await probe(outFile);

    // 5. upload to serving bucket
    const mediaPath = `${userId}/${mediaId}.mp4`;
    const posterPath = `${userId}/${mediaId}_thumb.jpg`;
    const up1 = await supabase.storage.from(SERVING_BUCKET).upload(mediaPath, await readFile(outFile), { contentType: 'video/mp4', upsert: true });
    if (up1.error) throw new Error(`upload mp4: ${up1.error.message}`);
    const up2 = await supabase.storage.from(SERVING_BUCKET).upload(posterPath, await readFile(posterFile), { contentType: 'image/jpeg', upsert: true });
    if (up2.error) throw new Error(`upload poster: ${up2.error.message}`);

    // 6. drop staging
    await supabase.storage.from(STAGING_BUCKET).remove([stagingPath]).catch(() => {});

    return { mediaPath, posterPath, durationSeconds: meta.duration, width: meta.width, height: meta.height };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
  if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' });

  // 1. auth
  const auth = req.headers['authorization'] || '';
  if (!SECRET || auth !== `Bearer ${SECRET}`) return send(401, { error: 'unauthorized' });

  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1_000_000) req.destroy(); });
  req.on('end', async () => {
    let input;
    try { input = JSON.parse(raw); } catch { return send(400, { error: 'bad_request' }); }
    if (!input.stagingPath || !input.userId || !input.mediaId) return send(400, { error: 'missing_fields' });
    try {
      const result = await transcode(input);
      send(200, result);
    } catch (e) {
      console.error('[transcode] failed:', e);
      send(500, { error: 'transcode_failed', message: String(e?.message ?? e) });
    }
  });
});

server.listen(PORT, () => console.log(`fame transcode worker listening on ${PORT}`));

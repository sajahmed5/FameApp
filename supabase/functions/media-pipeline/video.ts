// ============================================================================
// video.ts — PIPELINE STEP 6 for video: INTEGRATION POINT (not inline).
//
// WHY NOT INLINE: a Supabase Edge Function is a Deno isolate with no ffmpeg and
// tight CPU/time/memory limits. Real H.264 transcode, a 60 s hard cut, and
// poster-frame extraction cannot run here. This module therefore:
//   1. Enforces what it CAN in-edge: a server-side duration cap via an MP4/MOV
//      moov/mvhd probe (no decode needed), and the size cap (in index.ts).
//   2. Defines the `VideoTranscoder` interface so a worker (Mux, Coconut,
//      Cloudflare Stream, or the self-hosted ffmpeg worker in
//      scripts/transcode-worker/) can be dropped in without touching the
//      pipeline. The worker MUST: cap to 60 s, transcode to H.264 MP4, extract
//      a poster frame, STRIP all metadata, write both to the `media` bucket,
//      and delete the staging object.
//
// Reference ffmpeg (what the worker runs — verified locally on a real iPhone
// HEVC .mov, see scripts/transcode-worker/README.md):
//   ffmpeg -i in.mov -t 60 -map_metadata -1 \
//     -vf "scale='min(1080,iw)':-2" -c:v libx264 -preset veryfast -crf 23 \
//     -movflags +faststart -c:a aac -b:a 128k out.mp4
//   ffmpeg -i out.mp4 -frames:v 1 -q:v 3 poster.jpg
// (-map_metadata -1 strips container metadata incl. GPS/location atoms.)
// ============================================================================

export type TranscodeResult = {
  mediaPath: string; // object key in `media` bucket (H.264 mp4)
  posterPath: string; // object key in `media` bucket (poster jpg)
  durationSeconds: number;
  width: number;
  height: number;
};

export interface VideoTranscoder {
  transcode(input: { stagingPath: string; userId: string; mediaId: string }): Promise<TranscodeResult>;
}

/**
 * Best-effort duration probe for ISO-BMFF (MP4/MOV): find the movie header
 * (`mvhd`) and read duration/timescale. Returns null if it can't be parsed
 * (the worker still enforces the hard cap). No decoding required.
 */
export function probeDurationSeconds(bytes: Uint8Array): number | null {
  // Locate the last 'mvhd' box signature.
  const sig = [0x6d, 0x76, 0x68, 0x64]; // "mvhd"
  let at = -1;
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === sig[0] && bytes[i + 1] === sig[1] && bytes[i + 2] === sig[2] && bytes[i + 3] === sig[3]) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[at + 4]; // first byte after 'mvhd' is version
  try {
    if (version === 1) {
      // v1: creation(8) modification(8) timescale(4) duration(8)
      const timescale = dv.getUint32(at + 4 + 1 + 3 + 16);
      const durHi = dv.getUint32(at + 4 + 1 + 3 + 16 + 4);
      const durLo = dv.getUint32(at + 4 + 1 + 3 + 16 + 8);
      const duration = durHi * 2 ** 32 + durLo;
      return timescale ? duration / timescale : null;
    } else {
      // v0: creation(4) modification(4) timescale(4) duration(4)
      const timescale = dv.getUint32(at + 4 + 1 + 3 + 8);
      const duration = dv.getUint32(at + 4 + 1 + 3 + 12);
      return timescale ? duration / timescale : null;
    }
  } catch {
    return null;
  }
}

/**
 * External-transcoder client. Enabled only when TRANSCODER_URL is configured.
 * POSTs the staging object reference to the worker and expects it to return the
 * stored result. Left as a handoff because the actual transcode must run
 * outside the edge runtime; the concrete worker is a deploy choice.
 */
export function externalTranscoder(): VideoTranscoder | null {
  const url = Deno.env.get('TRANSCODER_URL');
  const secret = Deno.env.get('TRANSCODER_SECRET') ?? '';
  if (!url) return null;
  return {
    async transcode(input) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`transcoder returned ${res.status}`);
      return (await res.json()) as TranscodeResult;
    },
  };
}

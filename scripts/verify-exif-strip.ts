#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
// ============================================================================
// verify-exif-strip.ts — proves the media pipeline's EXIF strip on a real file
// using the SAME image module the Edge Function uses.
//
//   deno run --allow-read --allow-write --allow-net --allow-env \
//     scripts/verify-exif-strip.ts <input.(heic|jpg|png|webp)> [outDir]
//
// It reads GPS/EXIF (in-memory), runs processImage() (decode → strip → resize),
// runs verifyStripped(), and writes display + thumbnail JPEGs. Pair with
// `exiftool` on the outputs for an authoritative before/after (see README).
// ============================================================================
import { detectMedia } from '../supabase/functions/media-pipeline/content-type.ts';
import { readExif } from '../supabase/functions/media-pipeline/exif.ts';
import { processImage, verifyStripped } from '../supabase/functions/media-pipeline/image.ts';

const [input, outDir = '.'] = Deno.args;
if (!input) {
  console.error('usage: verify-exif-strip.ts <input> [outDir]');
  Deno.exit(2);
}

const bytes = await Deno.readFile(input);
const detected = detectMedia(bytes);
if (!detected.ok || detected.kind !== 'image') {
  console.error('not a supported image:', detected.ok ? detected.kind : detected.reason);
  Deno.exit(1);
}

console.log(`input: ${input} (${detected.mime}, ${bytes.length} bytes)`);

// Step 2 — EXIF read (what the pipeline extracts for suggestions)
const exif = await readExif(bytes);
console.log('EXIF read → gps:', JSON.stringify(exif.gps), '| takenAt:', exif.takenAt);

// Step 3 — strip via re-encode + verify
const processed = await processImage(bytes, detected.mime);
await verifyStripped(processed.display);
await verifyStripped(processed.thumbnail);
console.log('verifyStripped(): PASSED for display + thumbnail');

const base = input.split('/').pop()!.replace(/\.[^.]+$/, '');
const displayOut = `${outDir}/${base}.display.jpg`;
const thumbOut = `${outDir}/${base}.thumb.jpg`;
await Deno.writeFile(displayOut, processed.display);
await Deno.writeFile(thumbOut, processed.thumbnail);
console.log(`wrote ${displayOut} (${processed.width}x${processed.height}, ${processed.display.length} bytes)`);
console.log(`wrote ${thumbOut} (${processed.thumbnail.length} bytes)`);
console.log('\nNow verify no metadata survived:');
console.log(`  exiftool -EXIF:all -GPS:all -XMP:all -MakerNotes:all -ICC_Profile:all -s ${displayOut}`);

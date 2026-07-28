// ============================================================================
// content-type.ts — validate the true file type by inspecting the bytes
// (magic numbers), NEVER by the file extension or the client-supplied MIME
// type. The client's Content-Type is treated as an untrusted hint only.
// ============================================================================

export type DetectedKind =
  | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'
  | 'video/mp4' | 'video/quicktime';

export type Detection =
  | { ok: true; mime: DetectedKind; kind: 'image' | 'video' }
  | { ok: false; reason: string };

function has(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

// Inspect the leading bytes. We only accept formats we can actually process.
export function detectMedia(bytes: Uint8Array): Detection {
  // JPEG: FF D8 FF
  if (has(bytes, [0xff, 0xd8, 0xff])) return { ok: true, mime: 'image/jpeg', kind: 'image' };
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (has(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { ok: true, mime: 'image/png', kind: 'image' };
  // WEBP: "RIFF"????"WEBP"
  if (has(bytes, [0x52, 0x49, 0x46, 0x46]) && has(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return { ok: true, mime: 'image/webp', kind: 'image' };
  // ISO-BMFF (HEIC / MP4 / MOV): bytes 4..7 == "ftyp", then a brand.
  if (has(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = new TextDecoder().decode(bytes.slice(8, 12));
    // HEIC/HEIF still images (iPhone default) — decoded + re-encoded like any image.
    const heicBrands = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'];
    const mp4Brands = ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash', 'M4V '];
    const movBrands = ['qt  '];
    if (heicBrands.includes(brand)) return { ok: true, mime: 'image/heic', kind: 'image' };
    if (mp4Brands.includes(brand)) return { ok: true, mime: 'video/mp4', kind: 'video' };
    if (movBrands.includes(brand)) return { ok: true, mime: 'video/quicktime', kind: 'video' };
    // Unknown brand but ISO-BMFF: treat as mp4 (the transcoder normalises anyway).
    return { ok: true, mime: 'video/mp4', kind: 'video' };
  }
  return { ok: false, reason: 'Unsupported or unrecognised file type (content inspection failed).' };
}

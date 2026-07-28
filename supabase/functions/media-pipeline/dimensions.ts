// ============================================================================
// dimensions.ts — read pixel dimensions from the image HEADER (not EXIF), so the
// megapixel guard fires reliably even for files that carry no EXIF (edited or
// re-encoded images). Cheap: no decode, just header/box parsing.
//
// Falls back to null when it can't parse; the caller then tries EXIF, and if
// dimensions remain unknown the decode is attempted (best effort).
// ============================================================================

export type Dims = { width: number; height: number };

function jpeg(b: Uint8Array): Dims | null {
  let i = 2; // skip SOI
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    const isSOF = (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) ||
      (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf);
    if (isSOF) {
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width && height ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

function png(b: Uint8Array): Dims | null {
  if (b.length < 24) return null;
  const width = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
  const height = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
  return width && height ? { width, height } : null;
}

function webp(b: Uint8Array): Dims | null {
  if (b.length < 30) return null;
  const cc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (cc === 'VP8X') {
    const width = 1 + ((b[24]) | (b[25] << 8) | (b[26] << 16));
    const height = 1 + ((b[27]) | (b[28] << 8) | (b[29] << 16));
    return { width, height };
  }
  if (cc === 'VP8 ') {
    const width = (b[26] | (b[27] << 8)) & 0x3fff;
    const height = (b[28] | (b[29] << 8)) & 0x3fff;
    return width && height ? { width, height } : null;
  }
  if (cc === 'VP8L') {
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    const width = 1 + (bits & 0x3fff);
    const height = 1 + ((bits >> 14) & 0x3fff);
    return { width, height };
  }
  return null;
}

// HEIC: the 'ispe' box holds the image spatial extents. A file can carry several
// (thumbnails, previews); take the largest — that's the primary image we decode.
function heic(b: Uint8Array): Dims | null {
  let best: Dims | null = null;
  for (let i = 0; i + 16 <= b.length; i++) {
    if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) { // "ispe"
      const o = i + 8; // skip fullbox version/flags
      const w = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      const h = ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0;
      if (w > 0 && h > 0 && w < 100000 && h < 100000) {
        if (!best || w * h > best.width * best.height) best = { width: w, height: h };
      }
    }
  }
  return best;
}

export function readDimensions(bytes: Uint8Array, mime: string): Dims | null {
  switch (mime) {
    case 'image/jpeg': return jpeg(bytes);
    case 'image/png': return png(bytes);
    case 'image/webp': return webp(bytes);
    case 'image/heic': return heic(bytes);
    default: return null;
  }
}

// ============================================================================
// exif.ts — PIPELINE STEP 2 (EXIF READ), in-memory only.
// Extract GPS coordinates and capture timestamp for tag suggestion. These are
// returned to the caller and then DISCARDED — never persisted. Raw coordinates
// never touch the database (see geo.ts for the coarse grid cell that may be
// stored only if the user opts in).
// ============================================================================
import exifr from 'npm:exifr@7.1.3';

export type ExifReadout = {
  gps: { latitude: number; longitude: number } | null;
  takenAt: string | null; // ISO timestamp of capture, if present
};

export async function readExif(bytes: Uint8Array): Promise<ExifReadout> {
  let gps: ExifReadout['gps'] = null;
  let takenAt: string | null = null;
  try {
    const g = await exifr.gps(bytes);
    if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
      gps = { latitude: g.latitude, longitude: g.longitude };
    }
  } catch {
    // No/garbled GPS block — leave null.
  }
  try {
    const parsed = await exifr.parse(bytes, ['DateTimeOriginal', 'CreateDate']);
    const d: Date | undefined = parsed?.DateTimeOriginal ?? parsed?.CreateDate;
    if (d instanceof Date && !isNaN(d.getTime())) takenAt = d.toISOString();
  } catch {
    // No timestamp — leave null.
  }
  return { gps, takenAt };
}

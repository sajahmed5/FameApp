// ============================================================================
// geo.ts — LOCATION HANDLING + GEO TAGGING.
//
// Raw EXIF GPS is used ONLY for suggestion and is then discarded by the caller.
// The ONLY location value that may ever be stored (and only if the user opts in
// on the client) is `coarseLocationCell` — a low-precision geohash cell, never
// raw coordinates, never precise enough to identify a home address.
//
// Default geohash precision is 5 → cell ≈ 4.9 km × 4.9 km. Precision is
// configuration (config.tagging.locationGridPrecision).
// ============================================================================
import { config } from './config.ts';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Standard geohash encoder. Lower precision = coarser (more private) cell. */
export function geohashEncode(lat: number, lon: number, precision: number): string {
  let idx = 0, bit = 0, even = true;
  let hash = '';
  const latR = [-90, 90];
  const lonR = [-180, 180];
  while (hash.length < precision) {
    if (even) {
      const mid = (lonR[0] + lonR[1]) / 2;
      if (lon >= mid) { idx = (idx << 1) + 1; lonR[0] = mid; } else { idx = idx << 1; lonR[1] = mid; }
    } else {
      const mid = (latR[0] + latR[1]) / 2;
      if (lat >= mid) { idx = (idx << 1) + 1; latR[0] = mid; } else { idx = idx << 1; latR[1] = mid; }
    }
    even = !even;
    if (++bit === 5) { hash += BASE32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}

/**
 * The coarse cell that MAY be stored in posts.location_cell IF the user opts to
 * attach location (off by default — the client decides). Never store raw GPS.
 */
export function coarseLocationCell(gps: { latitude: number; longitude: number }): string {
  return 'gh' + config.tagging.locationGridPrecision + ':' +
    geohashEncode(gps.latitude, gps.longitude, config.tagging.locationGridPrecision);
}

/**
 * Reverse-geocode GPS to place-name tag SUGGESTIONS. Best-effort integration
 * point: enabled only when GEOCODE_PROVIDER + its key are configured. Returns
 * normalised, lowercase place names (suggestions only — never auto-applied).
 *
 * Left as an env-gated integration point because reverse geocoding needs a
 * provider account (Google Geocoding / Mapbox / self-hosted Nominatim); wiring
 * a specific paid provider is a deploy decision, not a code default.
 */
export async function reverseGeocode(gps: { latitude: number; longitude: number }): Promise<string[]> {
  const provider = Deno.env.get('GEOCODE_PROVIDER');
  const key = Deno.env.get('GEOCODE_API_KEY');
  if (!provider || !key) return [];

  try {
    if (provider === 'google') {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${gps.latitude},${gps.longitude}&result_type=locality|administrative_area_level_1|country&key=${key}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = await res.json();
      const names = new Set<string>();
      for (const r of json.results ?? []) {
        for (const comp of r.address_components ?? []) {
          if (['locality', 'administrative_area_level_1', 'country'].some((t) => comp.types?.includes(t))) {
            const n = String(comp.long_name ?? '').trim().toLowerCase();
            if (n) names.add(n);
          }
        }
      }
      return [...names].slice(0, 4);
    }
  } catch {
    // Best-effort only — geocoding failure never blocks the upload.
  }
  return [];
}

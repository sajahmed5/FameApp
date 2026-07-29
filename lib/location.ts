/**
 * Location helpers for attaching a place to a post.
 *
 * Privacy: we only ever store a COARSE geohash cell (precision 5 ≈ 5 km), never exact
 * coordinates — matching the server's `coarseLocationCell`. The device's precise position
 * is used transiently to (a) find nearby public venues to pick from, and (b) derive that
 * coarse cell; it is never persisted.
 */
import * as Location from 'expo-location';

import { supabase } from '@/lib/supabase';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const CELL_PRECISION = 5; // ~5km cell, matches the media pipeline

/** Standard geohash encoder (same algorithm as the server). */
export function geohashEncode(lat: number, lon: number, precision: number): string {
  let idx = 0;
  let bit = 0;
  let even = true;
  let hash = '';
  const latR = [-90, 90];
  const lonR = [-180, 180];
  while (hash.length < precision) {
    if (even) {
      const mid = (lonR[0] + lonR[1]) / 2;
      if (lon >= mid) {
        idx = (idx << 1) + 1;
        lonR[0] = mid;
      } else {
        idx = idx << 1;
        lonR[1] = mid;
      }
    } else {
      const mid = (latR[0] + latR[1]) / 2;
      if (lat >= mid) {
        idx = (idx << 1) + 1;
        latR[0] = mid;
      } else {
        idx = idx << 1;
        latR[1] = mid;
      }
    }
    even = !even;
    if (bit < 4) {
      bit++;
    } else {
      hash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }
  return hash;
}

/** The coarse cell we may store — never precise coordinates. */
export function coarseCell(lat: number, lon: number): string {
  return geohashEncode(lat, lon, CELL_PRECISION);
}

/** Request permission + read the device's current position. Returns null if denied. */
export async function getCurrentCoords(): Promise<{ lat: number; lon: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch {
    return null;
  }
}

export type NearbyPlace = { name: string; address: string | null; lat: number; lon: number };

/** Nearby public venues from the places proxy (Google, server-side) — for a picker. */
export async function nearbyPlaces(lat: number, lon: number): Promise<NearbyPlace[]> {
  const { data, error } = await supabase.functions.invoke('places', {
    body: { action: 'nearby', lat, lon, limit: 8 },
  });
  if (error) return [];
  const venues = ((data as { venues?: unknown[] })?.venues ?? []) as {
    name?: string;
    address?: string | null;
    lat?: number | null;
    lon?: number | null;
  }[];
  return venues
    .filter((v) => v.name && v.lat != null && v.lon != null)
    .map((v) => ({ name: v.name as string, address: v.address ?? null, lat: v.lat as number, lon: v.lon as number }));
}

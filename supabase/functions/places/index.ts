// ============================================================================
// places — venue/place tagging backend (M1). See docs/venue-tagging-design.md.
//
// Two actions, both authenticated + rate-limited:
//   nearby  { lat, lon, query?, limit? } → nearby public venues (search proxy)
//   attach  { postId, provider, provider_place_id } → find-or-create the venue
//           from authoritative Place Details and set posts.venue_id
//
// The Places API key stays SERVER-SIDE (env only). We store the public venue,
// never the caller's raw GPS. Venue tagging is refused for minors (also a DB
// trigger backstop). Provider is behind an interface so it's swappable.
// ============================================================================
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

const PROVIDER = Deno.env.get('PLACES_PROVIDER') ?? 'google';
const GOOGLE_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '';
const RATE_MAX = Number(Deno.env.get('PLACES_CALLS_PER_HOUR') ?? 120);
const GEOHASH_PRECISION = 5;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });

type Candidate = { provider: string; provider_place_id: string; name: string; category: string | null; address: string | null; lat: number | null; lon: number | null; distance_m: number | null };

// ---- Places provider (Google Places New) ----------------------------------
const FIELD_MASK = 'places.id,places.displayName,places.primaryType,places.formattedAddress,places.location';

async function googleNearby(lat: number, lon: number, query: string | undefined, limit: number): Promise<Candidate[]> {
  let res: Response;
  if (query) {
    res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify({ textQuery: query, maxResultCount: limit, locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: 3000 } } }),
    });
  } else {
    res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify({ maxResultCount: limit, locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius: 2000 } } }),
    });
  }
  if (!res.ok) throw new Error(`places search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.places ?? []).map((p: Record<string, never>) => mapPlace(p, lat, lon));
}

async function googleDetails(placeId: string): Promise<Candidate | null> {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'id,displayName,primaryType,formattedAddress,location' },
  });
  if (!res.ok) return null;
  return mapPlace(await res.json(), null, null);
}

function mapPlace(p: Record<string, never>, fromLat: number | null, fromLon: number | null): Candidate {
  const loc = (p as { location?: { latitude?: number; longitude?: number } }).location ?? {};
  const lat = loc.latitude ?? null, lon = loc.longitude ?? null;
  return {
    provider: 'google',
    provider_place_id: String((p as { id?: string }).id ?? ''),
    name: String((p as { displayName?: { text?: string } }).displayName?.text ?? ''),
    category: ((p as { primaryType?: string }).primaryType ?? null),
    address: ((p as { formattedAddress?: string }).formattedAddress ?? null),
    lat, lon,
    distance_m: fromLat != null && fromLon != null && lat != null && lon != null ? Math.round(haversine(fromLat, fromLon, lat, lon)) : null,
  };
}

function haversine(a1: number, o1: number, a2: number, o2: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(a2 - a1), dLon = toRad(o2 - o1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function geohash(lat: number, lon: number, precision: number): string {
  let idx = 0, bit = 0, even = true, hash = '';
  const latR = [-90, 90], lonR = [-180, 180];
  while (hash.length < precision) {
    if (even) { const m = (lonR[0] + lonR[1]) / 2; if (lon >= m) { idx = (idx << 1) + 1; lonR[0] = m; } else { idx <<= 1; lonR[1] = m; } }
    else { const m = (latR[0] + latR[1]) / 2; if (lat >= m) { idx = (idx << 1) + 1; latR[0] = m; } else { idx <<= 1; latR[1] = m; } }
    even = !even;
    if (++bit === 5) { hash += BASE32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}

// ---- clients ---------------------------------------------------------------
function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}
function userClient(jwt: string): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (PROVIDER === 'none' || !GOOGLE_KEY) return json({ error: 'places_not_configured' }, 501);

  // auth
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
  const jwt = auth.slice(7);
  const uclient = userClient(jwt);
  const { data: userData, error: authErr } = await uclient.auth.getUser();
  const uid = userData?.user?.id;
  if (authErr || !uid) return json({ error: 'unauthorized' }, 401);

  // rate limit (Places calls cost money)
  const { data: allowed } = await uclient.rpc('claim_places_slot', { _max: RATE_MAX, _window_seconds: 3600 });
  if (!allowed) return json({ error: 'rate_limited' }, 429);

  let body: { action?: string; lat?: number; lon?: number; query?: string; limit?: number; postId?: string; provider?: string; provider_place_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const svc = serviceClient();

  try {
    if (body.action === 'nearby') {
      if (typeof body.lat !== 'number' || typeof body.lon !== 'number') return json({ error: 'lat_lon_required' }, 400);
      const limit = Math.min(Math.max(body.limit ?? 12, 1), 20);
      const venues = await googleNearby(body.lat, body.lon, body.query, limit);
      return json({ venues: venues.filter((v) => v.provider_place_id && v.name) });
    }

    if (body.action === 'attach') {
      const { postId, provider_place_id } = body;
      if (!postId || !provider_place_id) return json({ error: 'missing_fields' }, 400);

      // ownership + minor gate (server-side)
      const { data: post } = await svc.from('posts').select('user_id').eq('id', postId).maybeSingle();
      if (!post || post.user_id !== uid) return json({ error: 'not_your_post' }, 403);
      const { data: prof } = await svc.from('profiles').select('age_band').eq('id', uid).maybeSingle();
      if (prof?.age_band === 'minor') return json({ error: 'not_available', message: 'Place tagging isn’t available on your account.' }, 403);

      // authoritative details (server-side key)
      const details = await googleDetails(provider_place_id);
      if (!details) return json({ error: 'place_not_found' }, 404);
      const cell = details.lat != null && details.lon != null ? 'gh5:' + geohash(details.lat, details.lon, GEOHASH_PRECISION) : null;

      const { data: venue, error: upErr } = await svc.from('venues').upsert({
        provider: 'google', provider_place_id: details.provider_place_id,
        name: details.name, category: details.category, lat: details.lat, lon: details.lon,
        address: details.address, location_cell: cell, updated_at: new Date().toISOString(),
      }, { onConflict: 'provider,provider_place_id' }).select('id, name, category, address').single();
      if (upErr || !venue) return json({ error: 'venue_upsert_failed' }, 500);

      const { error: setErr } = await svc.from('posts').update({ venue_id: venue.id }).eq('id', postId);
      if (setErr) return json({ error: 'attach_failed' }, 500);
      return json({ venue });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error('[places] error', e);
    return json({ error: 'places_error', message: String(e instanceof Error ? e.message : e) }, 502);
  }
});

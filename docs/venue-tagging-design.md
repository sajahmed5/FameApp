# Venue / place tagging — design

Status: **M1 (backend) BUILT + deployed** (migration 20260731090000_venues +
`supabase/functions/places`). Google Places key configured. **M2–M4 (client
picker, venue page, discovery) still to build** — see the milestones at the end.
This doc remains the implementation spec.

## 1. Goal

Let a user attach a specific **public place** to a post — a restaurant, café, shop,
bar, gym, or landmark — so the app can answer "where was that steak from?" and use the
venue as a discovery axis (a venue page, "more posts from here", filtering the deck by
venue). Distinct from the existing free-text geo tags (city / area names), which stay.

Non-goals for v1: check-ins/social presence, venue ratings/reviews, owner-claimed venue
pages, maps UI. Those can come later on top of the same data.

## 2. Privacy model (the important part)

The existing location design is deliberately coarse — a ~5 km geohash
(`posts.location_cell`), off by default — to protect **the user's** position (their
home). Venue tagging is a *different* thing and must not undo that:

- **We store the venue, never the user's raw GPS.** The EXIF GPS is used only to *find*
  nearby venues, then discarded (as it already is). What persists is a `venue_id`
  pointing at a public place.
- A public business's coordinates are public data, so the `venues` table **may** hold the
  venue's precise lat/lon (for a map/venue page). That is the venue's location, not the
  user's.
- Venue tagging is **opt-in**, same as location today. Off by default.
- `location_cell` (coarse area) and `venue_id` are independent: a post can have neither,
  either, or both. If a venue is attached we can *derive* a coarse `location_cell` from
  the venue for area features, but we never store the user's exact coordinates.
- **Minors / private accounts:** for `age_band = 'minor'`, do not surface venue tagging
  (or restrict to non-precise landmarks) — tagging the exact café by a child's post is a
  safety concern. Enforce server-side in the attach RPC, not just the UI.

Residual risk (accepted, same as every social app's place tags): a user who repeatedly
tags the venue nearest their home leaks a weak signal. Opt-in + the minor rule cover the
cases that matter.

## 3. Provider

The Places API key must stay **server-side** (never in the client bundle), so all Places
calls go through an Edge Function — same rule as the Vision key.

| Provider | Nearby search | Details | Cost (approx) | Notes |
|---|---|---|---|---|
| **Google Places (New)** | Nearby Search + Text Search | Place Details | ~$32/1k Nearby, SKU-based; generous monthly credit | Best coverage, pairs with the Vision key/billing we're already adding. **Recommended.** |
| Foursquare Places | `/places/nearby`, `/places/search` | `/places/{id}` | Free tier ~ generous; cheaper at scale | Strong POI data, food-focused; separate account |
| Mapbox Search Box | `/searchbox` suggest/retrieve | retrieve | Free tier, then per-request | Good if we later add Mapbox maps |

**Recommendation: Google Places (New API)** for launch — coverage + one billing/console
with Vision. Keep the provider behind an interface (`PlacesProvider`) so it's swappable,
exactly like the vision/transcoder integration points.

Config (Edge Function secrets, env-only):
`PLACES_PROVIDER=google`, `GOOGLE_PLACES_API_KEY=…`.

## 4. Data model

```sql
-- Migration: 20260729xxxxxx_venues

create table public.venues (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null,               -- 'google' | 'foursquare' | ...
  provider_place_id  text not null,               -- the provider's stable place id
  name               text not null,
  category           text,                         -- normalised, e.g. 'restaurant', 'cafe'
  -- Public venue location (NOT the user's). Nullable if the provider omits it.
  lat                double precision,
  lon                double precision,
  address            text,                         -- short display address
  location_cell      text,                         -- coarse geohash of the venue (area features)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (provider, provider_place_id)             -- de-dupe: one row per real place
);

alter table public.posts add column venue_id uuid references public.venues (id) on delete set null;
create index posts_venue_id on public.posts (venue_id) where venue_id is not null;
create index venues_location_cell on public.venues (location_cell);
```

- **Venues are global and shared** — de-duped by `(provider, provider_place_id)`. Two
  users posting from the same café point at the same `venues` row → "all posts from here"
  falls out for free.
- **A venue is NOT a tag.** It's a first-class column (`posts.venue_id`), separate from
  `post_tags`. (We *may* also auto-suggest the venue's category as a normal tag, e.g.
  `steakhouse` → `#steak`, but that's optional and goes through the existing tag path.)
- RLS: `venues` is world-readable to `authenticated` (public place data), insert/update
  only via the SECURITY DEFINER RPC below (clients can't write arbitrary venue rows).
- `posts.venue_id` is covered by the existing `posts` update grant additions (add
  `venue_id` to the granted update/insert columns) so the owner can set/clear it.

## 5. Trust: how a post gets a venue_id

The client must **not** be trusted to supply the venue's name/category/coords (it could
forge them, and the API key can't be in the client). So:

1. Client shows nearby candidates (from the Edge Function, §6) and the user taps one.
2. Client calls a SECURITY DEFINER RPC **`attach_venue(post_id, provider, provider_place_id)`**
   OR passes `provider_place_id` into `createPost`. The server-side path:
   - Rejects if the caller is a minor (age_band gate) or not the post owner.
   - **Find-or-create** the `venues` row by `(provider, provider_place_id)`: if missing,
     the Edge Function fetches **Place Details** server-side (authoritative name /
     category / coords) and inserts it. This keeps the key server-side and the venue data
     trustworthy.
   - Sets `posts.venue_id`.

Because venue resolution needs the API key, the find-or-create-from-details step lives in
the Edge Function (`places` function, §6), and the RPC calls it — or the whole
attach flow is an Edge Function endpoint that also updates the post via service role.
Simplest: **one Edge Function** with two actions (`nearby`, `attach`); `attach` upserts
the venue and sets `posts.venue_id` for a post the caller owns.

## 6. Edge Function: `places`

New function `supabase/functions/places`, same auth/rate-limit skeleton as
`media-pipeline`. Key stays in env. Actions:

```
POST /functions/v1/places   { action: "nearby", lat, lon, query?, limit? }
→ { venues: [ { provider, provider_place_id, name, category, distance_m, address } ] }

POST /functions/v1/places   { action: "attach", postId, provider, provider_place_id }
→ { venue: { id, name, category, address } }     // upserts venue, sets posts.venue_id (owner-checked, minor-gated)
```

- `nearby` proxies the provider's Nearby/Text Search from the given coordinates. Coords
  come from the photo's EXIF GPS (already extracted by `media-pipeline`) or, if absent,
  the device's current location (§7). Rate-limited per user (Places calls cost money) and
  results cached briefly by rounded coords.
- `attach` does the trusted find-or-create + sets `venue_id`.
- A `PlacesProvider` interface (`nearby`, `details`) with a Google implementation; swap
  by env, mirroring `vision.ts` / the transcoder.

**Where the GPS comes from:** `media-pipeline` already returns `suggestions.gps`. The
compose screen can pass that straight into `places` `nearby` — no new GPS handling for
captured/gallery photos that carry EXIF. Optionally the pipeline could *also* return a
first page of nearby venues in its response (one extra call, same GPS) so suggestions
appear instantly; keep that behind a flag to control Places spend.

## 7. No-GPS fallback (device location)

Many gallery photos and all simulator photos have no EXIF GPS. To still offer venues:

- Add **`expo-location`** (new dep + foreground-location permission, explained
  before requesting like the camera). If the photo has no GPS and the user taps "Tag a
  place", request one-off `getCurrentPositionAsync` and use that for `nearby`.
- This is the user's *live* position used transiently to find nearby venues — still only
  the chosen venue is stored, never the coordinates. Opt-in via the same location toggle.

## 8. UI

**Compose / Edit — under the Location section:**
- Toggle stays ("Add location — approximate area only"). Below it, a new **"Tag a place
  (optional)"** row.
- Tapping opens a venue picker: a list of nearby candidates (name, category icon,
  distance) + a search field (Text Search) for when the right place isn't in the nearby
  list. Selecting one shows a removable venue chip. Only one venue per post (v1).
- Distinct from the geo *text* tags (city/area), which remain in the tag picker.
- Loading/empty/error states: "Finding places nearby…", "No places found — search", and a
  retry on failure. If location permission is denied, show the Settings path (reuse the
  camera pattern).

**Deck card:** if a post has a venue, show a small venue chip (📍 name · category) above
or near the caption; tapping it → the venue page.

**Venue page (`app/venue/[id].tsx`, can be M3):** venue header (name, category, address,
map thumbnail later) + a deck/grid of posts tagged there (`get_venue_deck`, mirroring
`get_deck` visibility rules).

## 9. Discovery integration

- Venue chip → venue page (`get_venue_deck(venue_id)`), respecting the same
  public/approved + private/accepted-follower visibility as `get_deck`.
- Later: a "near me / popular venues" surface; filter the main deck by venue; venue as a
  ranking signal. Out of scope for v1 but the schema supports it.

## 10. Abuse / correctness

- **Wrong/spam venue tags:** venue is owner-set and editable; report/moderation can strip
  a `venue_id`. Consider a soft cap on venue changes.
- **Cost control:** rate-limit `nearby`/`attach` per user (reuse the `claim_..._slot`
  pattern), cache nearby results by rounded coords, and cache Place Details in `venues`
  (we already persist them). Don't call Places on every keystroke — debounce search.
- **Stale venues:** refresh `venues` details on a TTL (e.g. re-fetch on attach if
  `updated_at` older than N days).

## 11. Milestones

- **M1 — data + backend:** `venues` migration + `posts.venue_id` + grants; `places` Edge
  Function (`nearby`, `attach`) with the Google provider; per-user rate limit; minor gate.
  Verify: nearby returns real venues from a GPS; attach upserts + sets `venue_id`;
  non-owner/minor rejected (runtime RLS test like the others).
- **M2 — compose UI:** venue picker under Location (nearby + search + selected chip),
  wired to `places`; store `venue_id` via `attach` on post; edit screen can change/remove.
  Add `expo-location` for the no-GPS fallback.
- **M3 — display + venue page:** venue chip on deck cards; `app/venue/[id].tsx` +
  `get_venue_deck`.
- **M4 — discovery:** venue-based browse/filter, "popular nearby", ranking signal.

## 12. Decisions needed before building

1. **Provider** — recommend Google Places (New); confirm, then create the key
   (console.cloud.google.com → enable Places API (New) → restricted key →
   `supabase secrets set GOOGLE_PLACES_API_KEY=…`).
2. **Device-location fallback** — OK to add `expo-location` for no-GPS photos? (Otherwise
   venue tagging only works on photos that carry EXIF GPS.)
3. **Minor policy** — hide venue tagging entirely for `age_band = 'minor'`, or allow
   landmarks only? (Recommend: hide entirely for v1.)
4. **Category → tag suggestion** — auto-suggest the venue's category as a normal tag
   (still user-confirmed)? (Recommend: yes, low effort, good signal.)

## 13. New config / deps summary

- Edge Function secrets: `PLACES_PROVIDER`, `GOOGLE_PLACES_API_KEY` (server-side only).
- New client dep (M2): `expo-location` (foreground permission, explained before request).
- Reuses: `media-pipeline` GPS extraction, the coarse-`location_cell` helper (`geo.ts`),
  the per-user rate-limit pattern, and the owner/minor checks already in the schema.

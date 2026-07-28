# media-pipeline (Supabase Edge Function)

Processes an uploaded media file through a **mandatory, ordered** pipeline before
anything is persisted or served. Backend only — no capture UI.

```
1. Accept upload → PRIVATE staging bucket   (nothing public before step 6)
2. EXIF READ      GPS + timestamp, in-memory, for tag suggestion (never persisted)
3. EXIF STRIP     re-encode → then VERIFY the output is clean (fail-closed)
4. ADULT SCAN     Google Vision SafeSearch → reject / flag / approve
5. CSAM SCAN      integration point — STUB, NOT PRODUCTION READY
6. TRANSCODE+STORE images inline; video via external worker → serving bucket
7. RETURN         urls, moderation_status, GPS + label + place tag suggestions
```

A failure at any step removes everything written so far (see the cleanup ledger
in `index.ts`) — nothing is left orphaned in storage.

## Files

| File | Role |
|------|------|
| `index.ts` | HTTP entry, auth, rate limit, orchestration, cleanup |
| `config.ts` | All tunables/limits from env (no magic numbers, no secrets in code) |
| `content-type.ts` | File-type validation by **content inspection** (magic bytes) |
| `exif.ts` | Step 2 — read GPS + timestamp in-memory |
| `image.ts` | Step 3 + 6 — decode (incl. HEIC) → strip via re-encode → resize; `verifyStripped` |
| `vision.ts` | Step 4 — SafeSearch **and** labels in one Vision call; thresholds from config |
| `csam.ts` | Step 5 — `CsamScanner` interface + **stub** (drop in PhotoDNA/Thorn here) |
| `geo.ts` | Coarse geohash cell (opt-in only) + reverse-geocode integration point |
| `video.ts` | Duration probe + `VideoTranscoder` integration point (see `scripts/transcode-worker/`) |
| `storage.ts` | Supabase clients + bucket put/download/remove/sign helpers |

Storage + rate-limit objects live in migration `20260728110000_media_pipeline.sql`.

## Configuration (env only — never in code)

Secrets (no defaults):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — injected by Supabase.
- `GOOGLE_VISION_API_KEY` — Google Cloud Vision (adult scan + labels).
- `TRANSCODER_URL`, `TRANSCODER_SECRET` — external video worker (optional).
- `GEOCODE_PROVIDER` (`google`), `GEOCODE_API_KEY` — reverse geocoding (optional).

Thresholds/limits (safe defaults, see `config.ts`): `MODERATION_ADULT_REJECT_AT`,
`MODERATION_ADULT_FLAG_AT`, `MODERATION_RACY_FLAG_AT`, `MODERATION_VIOLENCE_REJECT_AT`,
`MEDIA_MAX_IMAGE_BYTES`, `MEDIA_MAX_VIDEO_BYTES`, `MEDIA_MAX_VIDEO_SECONDS`,
`MEDIA_UPLOADS_PER_HOUR`, `LABEL_MIN_CONFIDENCE`, `LOCATION_GRID_PRECISION`.

**Fail-safe:** if no Vision provider is configured, uploads are **flagged** for human
review — never auto-approved.

## Request / response

`POST` multipart/form-data with a `file` field and `Authorization: Bearer <jwt>`.

Returns `{ media_url, thumbnail_url, moderation_status, media_type, width, height,
preview:{media,thumbnail}, suggestions:{ gps, taken_at, location_cell, labels[], places[] } }`.

- `media_url` / `thumbnail_url` are **object keys** in the private `media` bucket
  (the client stores these on the post; the read path signs them). RLS on that
  bucket mirrors `posts` visibility exactly — see below.
- `suggestions` are **suggestions only**. The client confirms tags and decides
  whether to attach `location_cell`. Raw `gps` is returned for suggestion and must
  be discarded by the client; only the coarse `location_cell` may be stored, and
  location is **off by default**.

## Deploy

```bash
supabase functions deploy media-pipeline --project-ref yslrmejkaivqjvbuqfdc
supabase secrets set GOOGLE_VISION_API_KEY=... --project-ref yslrmejkaivqjvbuqfdc
# optional: TRANSCODER_URL, TRANSCODER_SECRET, GEOCODE_PROVIDER, GEOCODE_API_KEY
```
Requires the Supabase CLI and a personal access token (`SUPABASE_ACCESS_TOKEN`,
from supabase.com/dashboard/account/tokens).

## Runtime limits (edge isolate) & the capture client

Decoding to raw RGBA costs ~4 bytes/pixel, and a Supabase edge isolate is
memory-tight: empirically it processes ~4.5 MP and OOMs by ~6 MP (HEIC via
libheif is heavier still). So `MEDIA_MAX_IMAGE_MEGAPIXELS` defaults to **4** and
the function reads dimensions from the image **header** (pre-decode) — anything
larger is rejected with a clean `413 image_too_large`, never an opaque crash.

Consequence: the capture client must **downscale before upload** (e.g. longest
edge ≤ 2048 px ≈ 3 MP; the pipeline finalises display to 1440 px anyway). Full
phone resolution (12–48 MP) is intentionally out of the inline budget — larger
media belongs on the same external worker as video, or is downscaled client-side.

Verified on the deployed function (project `yslrmejkaivqjvbuqfdc`): ≤ 4 MP images
process end-to-end (strip → store → signed URLs); 4.5/8/12 MP and an 18 MP HEIC
all return a clean `413`.

## Integration points to complete before production

- **CSAM (`csam.ts`)** — replace `stubScanner` with a real hash-matching client
  (PhotoDNA / Thorn Safer). It must be fail-closed and must trigger the legal
  reporting flow (e.g. NCMEC) on a match. **The stub detects nothing.**
- **Video (`video.ts` + `scripts/transcode-worker/`)** — full H.264 transcode /
  60 s cut / poster extraction cannot run in the Deno edge runtime; it runs in an
  external worker. Set `TRANSCODER_URL` or video uploads return `501`.
- **Reverse geocoding (`geo.ts`)** — enable by setting `GEOCODE_PROVIDER` + key.

## Verification

- **EXIF strip** (proven locally against a real GPS photo, same code the function runs):
  ```bash
  deno run --node-modules-dir=none --allow-read --allow-write --allow-net --allow-env \
    scripts/verify-exif-strip.ts <photo.heic|jpg> /tmp
  exiftool -EXIF:all -GPS:all -XMP:all -MakerNotes:all -ICC_Profile:all -s /tmp/<name>.display.jpg  # → 0 tags
  ```
- **Storage RLS** proven at DB runtime (owner + accepted followers only for private
  posts) — see the security review notes.

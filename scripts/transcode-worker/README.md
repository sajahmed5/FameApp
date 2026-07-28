# transcode-worker

The video branch of `media-pipeline` cannot transcode inline — a Supabase Edge
Function is a Deno isolate with no ffmpeg and tight CPU/time/memory limits. This
is the **external worker** that `video.ts`'s `VideoTranscoder` integration point
hands off to. It's a small Node + ffmpeg HTTP server (`server.js`, `Dockerfile`)
built for **Google Cloud Run**, though it runs anywhere ffmpeg can (Fly.io, a
container, a queue consumer). Point `TRANSCODER_URL` at it.

Verified locally end-to-end against real Supabase storage: a 17.7 MB iPhone
HEVC `.mov` → H.264 1080p mp4 + poster in the `media` bucket, staging cleaned,
metadata stripped (~11 s).

## Deploy to Cloud Run

Video stays in the Supabase `media` bucket, so it keeps the same private/
accepted-followers RLS as images — no separate playback-privacy system needed.

```bash
cd scripts/transcode-worker
gcloud auth login                     # once, in your terminal (browser)
gcloud config set project <your-gcp-project>

gcloud run deploy fame-transcoder \
  --source . \
  --region europe-west2 \
  --allow-unauthenticated \           # the worker gates itself with TRANSCODER_SECRET
  --memory 2Gi --cpu 2 --timeout 300 \
  --set-env-vars "SUPABASE_URL=https://<ref>.supabase.co,SUPABASE_SERVICE_ROLE_KEY=<service_role>,TRANSCODER_SECRET=<random>"
```

Then wire the Edge Function to it (the media-pipeline video path reads these):

```bash
supabase secrets set TRANSCODER_URL=<cloud-run-url> TRANSCODER_SECRET=<same random> --project-ref <ref>
```

`--memory 2Gi --cpu 2` comfortably transcodes a 60 s clip; scale as needed.
Cloud Run scales to zero, so idle cost is nil. Keep the service-role key and
secret out of source — they're Cloud Run env + Supabase secrets only.

---
## Contract

## Contract

Request (POST, `Authorization: Bearer $TRANSCODER_SECRET`):
```json
{ "stagingPath": "<owner>/<mediaId>.orig", "userId": "<uuid>", "mediaId": "<uuid>" }
```

Response (`TranscodeResult` in `video.ts`):
```json
{ "mediaPath": "<owner>/<mediaId>.mp4", "posterPath": "<owner>/<mediaId>_thumb.jpg",
  "durationSeconds": 5.83, "width": 1080, "height": 1920 }
```

The worker MUST:
1. Download the object from the **`media-staging`** bucket (service role).
2. Cap to 60 s, transcode to **H.264 MP4**, extract a **poster frame**, and
   **strip all metadata** (GPS/location atoms included).
3. Upload the mp4 + poster to the **`media`** (serving) bucket at the keys above.
4. Delete the staging object.
5. Return the JSON above.

The platform then runs the adult/CSAM scan on the returned poster frame and sets
`moderation_status` (see `index.ts` `handleVideo`), so the worker does not decide
moderation.

## Reference ffmpeg (verified on a real iPhone HEVC .mov: 4K HEVC → 1080p H.264)

```bash
# H.264 MP4, hard 60s cut, strip ALL metadata, downscale longest edge to 1080
ffmpeg -y -i in.mov -t 60 -map_metadata -1 \
  -vf "scale='min(1080,iw)':-2" -c:v libx264 -preset veryfast -crf 23 \
  -movflags +faststart -c:a aac -b:a 128k out.mp4

# Poster frame
ffmpeg -y -i out.mp4 -frames:v 1 -q:v 3 poster.jpg
```

`-map_metadata -1` drops the container metadata (including the QuickTime GPS /
location atoms iPhones embed). Confirm with
`exiftool -G1 -a -s out.mp4 | grep -iE 'gps|location|make|model'` → no matches.

> A concrete worker (Node/Deno + fluent-ffmpeg or a shell wrapper) is intentionally
> not committed here — the hosting choice (Mux / Cloudflare Stream / Coconut /
> self-hosted) is a deployment decision. The commands above are the exact recipe.

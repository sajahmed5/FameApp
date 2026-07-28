# transcode-worker (reference)

The video branch of `media-pipeline` cannot transcode inline — a Supabase Edge
Function is a Deno isolate with no ffmpeg and tight CPU/time/memory limits. This
directory documents the **external worker** that `video.ts`'s `VideoTranscoder`
integration point hands off to. Deploy it anywhere ffmpeg can run (a container,
Cloud Run, Fly.io, a queue consumer) and point `TRANSCODER_URL` at it.

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

# Publishing phixr (App Store + Google Play)

This project is set up for **EAS Build** (native binaries), **EAS Submit** (upload to
the stores), and **EAS Update** (over-the-air JS/asset updates — no review).

Config already in place:
- `expo-updates` installed; `app.json` has `updates.url` + `runtimeVersion.policy: "fingerprint"`.
- `eas.json` with `development` / `preview` / `production` build profiles, each bound to an
  update channel of the same name, plus a `production` submit profile.
- EAS project id `ce6bcabb-42f6-4ae2-90d7-5ca670af9229` (owner `sajahmed5`).

## The one rule to remember

| You changed… | Ship it with | Reaches users |
|---|---|---|
| JS / styles / copy / images | `eas update --channel production` | minutes, **no review** |
| Native (a native lib, icon, splash, permissions, SDK bump, `app.json` native keys) | `eas build` → `eas submit` | store review (hrs–days) |
| Backend (Supabase migrations/RPCs) | apply in Supabase | instant, independent of the app |

`runtimeVersion: fingerprint` protects you here: an OTA update only installs on a binary
whose native fingerprint matches, so you can never push a JS update that needs native code.
When the fingerprint changes (a native change), you simply build + submit a new binary.

## Accounts / prerequisites (one-time)

- **Apple Developer Program** — $99/yr → create the app record in App Store Connect.
- **Google Play Developer** — $25 one-time → create the app in Play Console.
- `npm i -g eas-cli` then `eas login` (Expo account `sajahmed5`).
- Note: the EAS project was first created as "fame". If `eas build` warns about a slug
  mismatch, rename the project to **phixr** at https://expo.dev, or accept the prompt to link.

## Fill in before first submit — `eas.json` → `submit.production`

- **iOS:** `appleId` (your Apple ID email), `ascAppId` (App Store Connect app's numeric ID),
  `appleTeamId` (10-char team ID).
- **Android:** download a Play **service-account JSON** (Play Console → Setup → API access),
  save it as `secrets/play-service-account.json` (that folder is gitignored).

## CRITICAL — Supabase/analytics keys for the cloud build

`app.config.ts` injects `process.env.SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SENTRY_DSN`,
`POSTHOG_KEY`, `POSTHOG_HOST` at build time. EAS builds in the cloud and does **not** see
your local `.env`, so set them as EAS environment variables once per environment:

```bash
eas env:create --environment production --name SUPABASE_URL --value "https://yslrmejkaivqjvbuqfdc.supabase.co"
eas env:create --environment production --name SUPABASE_ANON_KEY --value "<publishable anon key>"
# repeat for SENTRY_DSN, POSTHOG_KEY, POSTHOG_HOST (optional — empty = feature disabled)
```

(The anon key is a publishable client key, safe to ship. Never add the service-role key.)

## First release

```bash
# 1. Build the store binaries (credentials are generated/managed by EAS on first run)
eas build --platform ios --profile production
eas build --platform android --profile production

# 2. Upload to the stores
eas submit --platform ios --profile production --latest
eas submit --platform android --profile production --latest
```

Then in App Store Connect / Play Console: complete the listing (screenshots, description),
Apple **privacy labels** / Google **Data Safety** form, age rating, and submit for review.
(See `docs/store-submission.md` for the drafted listing content.)

## Everyday updates (the fast path)

```bash
# JS / asset change only — goes over-the-air to installed apps:
eas update --channel production --message "Fix X, tweak Y"
```

Users get it on the next app launch. No build, no review.

## When you make a NATIVE change

Anything that changes the native fingerprint (new native dependency, icon/splash,
permissions, `app.json` native keys, Expo SDK upgrade) needs a fresh binary:

```bash
eas build --platform all --profile production
eas submit --platform all --profile production --latest
```

Bump `expo.version` in `app.json` for each store release (Apple/Google require a new
version string); EAS auto-increments the build number / version code (`autoIncrement`).

## Test before the stores (optional but recommended)

```bash
# Install a dev/preview build on your own device first:
eas build --profile preview --platform ios      # or android (produces an .apk)
```

# Store submission notes

Companion to [`data-collection.md`](./data-collection.md) (privacy labels / data safety) and
[`age-rating.md`](./age-rating.md) (age rating). This file tracks the remaining app-store
submission mechanics.

## App icon & splash — configured

Set in `app.json` (verified present in `assets/`):

- **iOS icon:** `assets/expo.icon`
- **App icon (shared/web):** `assets/images/icon.png`
- **Android adaptive icon:** foreground/background/monochrome under `assets/images/android-icon-*.png`, background `#E6F4FE`
- **Splash screen:** `expo-splash-screen` plugin, image `assets/images/splash-icon.png`, background `#208AEF`

Replace the placeholder marks in these assets with final brand art before submission; the
configuration wiring is done.

## Account recovery — decision: no phone number

**Recommendation: do not collect a phone number; use email-based recovery, with
support-mediated recovery for lost email access.** Implemented accordingly.

Why:

1. **It was never collected** — there is no phone field to "verify or drop"; adding one is
   net-new data collection, not a cleanup.
2. **SMS OTP is a liability, not a security win** — it introduces SIM-swap account-takeover
   risk, an ongoing SMS cost, and a new piece of regulated PII to store and protect.
3. **Email verification is already mandatory** before feed access, so email is a proven
   channel we already own.
4. **Coverage:**
   - Forgot password (has email) → email reset link (`(auth)/forgot-password`).
   - Lost access to email → support-mediated recovery with identity check (`app/recover.tsx`),
     linked from the forgot-password screen.
   - Suspicious sessions → "sign out of all other devices" (Settings → Devices & sessions).

If SMS recovery is ever wanted, it can be added later behind the same recovery screen — but
it should be a deliberate choice given the trade-offs above.

## Data rights (implemented, required for review)

- **Export** — Settings → Account → Export my data → a JSON archive (profile, posts,
  comments, follows) + signed media links, delivered by a signed download link (edge
  function `data-export`).
- **Deletion** — Settings → Account → Delete account → full erasure of DB rows (auth.users
  cascade) **and** every storage object the user owns (edge function `delete-account`),
  with no orphans. CSAM evidence under legal retention is preserved and is not
  user-erasable.

## Pre-submission checklist

- [ ] Replace placeholder Terms, Privacy Policy, and Community Guidelines text
  (`constants/legal.ts`) and bump `TERMS_VERSION` if needed.
- [ ] Replace placeholder icon/splash art with final brand assets.
- [ ] Fill Apple privacy labels from `data-collection.md`.
- [ ] Fill Google Play Data safety from `data-collection.md`.
- [ ] Complete the age-rating questionnaires from `age-rating.md` (expect 17+ / Mature).
- [ ] Set the real support email (currently `support@lovefame.co.uk`) and monitor it —
  required for a UGC app.
- [ ] Confirm the moderation queue has a staffed reviewer (App Review asks for UGC apps).

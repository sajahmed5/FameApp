# Data collection disclosure

Source document for **Apple App Privacy labels** and **Google Play Data safety**. It lists
every category of personal data the app collects, why, and whether it is shared with third
parties. Keep it in sync with the code — if a new SDK or data flow is added, update this
file and the store listings.

> Legend — **Linked** = tied to the user's identity. **Purpose** codes follow Apple's
> categories (App Functionality, Analytics, etc.). "Third party" names the processor and
> whether data leaves our infrastructure.

## Data we collect

| Data | Collected | Linked | Purpose | Shared with third parties |
|---|---|---|---|---|
| **Email address** | At signup; required for auth + verification | Yes | App Functionality (account, login, security) | Supabase (auth/DB processor). Not sold or used for tracking. |
| **Date of birth** | At signup; required for age gating (§9) | Yes | App Functionality (under-13 block, under-18 protections) | Supabase only. |
| **Display name & handle** | At signup | Yes | App Functionality (public profile) | Supabase; handle/display name are shown publicly in-app + on public post pages. |
| **Bio / avatar** | Optional, user-provided | Yes | App Functionality (profile) | Supabase; public. |
| **Photos & videos** | When the user posts / sends a story or message | Yes | App Functionality (core product) | Supabase Storage. Sent to Google Vision (auto-tag + adult-content scan) and a CSAM scanner on upload; EXIF is stripped before storage. |
| **Coarse location** | Opt-in per post, OFF by default | Yes | App Functionality (local discovery) | Stored as a fuzzed grid cell only — never exact coordinates. EXIF GPS is used transiently for tag suggestions then stripped. |
| **Photo EXIF/GPS metadata** | Read transiently on upload | No | App Functionality (tag suggestion) | Read in-memory server-side, then **stripped** — never persisted or served. |
| **User content** (captions, comments, messages, tags) | When created | Yes | App Functionality | Supabase. Messages are member-only; public content is public. |
| **Usage / product analytics** | Explicit events only; opt-out in settings | Pseudonymous (user id only) | Analytics | PostHog. **No email/handle**, no autocapture, no IP geolocation, and never swipe↔post attribution. |
| **Crash diagnostics** | On crash/error | Pseudonymous (user id only) | App Functionality (stability) | Sentry. PII scrubbed (emails/tokens/URLs redacted; user reduced to id). |
| **Push token** | If notifications are enabled | Yes | App Functionality (notifications) | Expo push service. |
| **IP address** | Transiently at request time | No | App Functionality + Security (rate limiting, auth) | Supabase infra; not stored as a profile attribute. Analytics geolocation is disabled. |
| **Points / activity ledger** | As the user participates | Yes | App Functionality (the reach mechanic) | Supabase; swipe ledger rows never reference the swiped post (anonymity, §9). |

## Data we do NOT collect

- **Phone number** — deliberately not collected (see `age-rating.md` and the account-recovery decision). No SMS.
- **Precise GPS coordinates** — only a coarse, opt-in grid cell is ever stored.
- **Contacts, health, financial data, browsing history.**
- **Third-party advertising identifiers / cross-app tracking** — none. The app does not
  track users across other companies' apps or sites, so **App Tracking Transparency is not
  required** and the "Used to Track You" bucket is empty.

## Third-party processors

| Processor | Role | Data it sees |
|---|---|---|
| Supabase | Auth, database, storage, realtime | All account + content data (our primary processor). |
| Google Cloud Vision | Auto-tagging + adult-content detection on upload | The uploaded image bytes. |
| Google Places | Venue/geo tag suggestions | Coarse location from EXIF (pre-strip), when present. |
| CSAM scanner (PhotoDNA / Thorn) | Legal CSAM detection on upload | Image hashes/bytes. Positive matches are escalated to NCMEC. |
| PostHog | Product analytics | Pseudonymous events (user id + non-PII properties). |
| Sentry | Crash reporting | Scrubbed crash reports (user id only). |
| Expo | Push notification delivery | Push token + notification payload. |

## Store-form quick answers

**Apple — Data used to track you:** none.
**Apple — Data linked to you:** Contact Info (email), User Content (photos/videos, captions,
messages), Identifiers (user id), Usage Data, Diagnostics, Location (coarse, opt-in).
**Apple — Data not linked to you:** Diagnostics/Usage where pseudonymous.
**Google Play Data safety — Data collected & shared:** as per the table above; data is
encrypted in transit; users can request export and deletion in-app (Settings → Account).

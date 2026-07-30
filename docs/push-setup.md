# Push notifications setup (Android FCM + iOS APNs)

The app's push code is complete (`lib/notifications.ts`, `lib/notifications-provider.tsx`,
the `send-push` Edge Function and the DB triggers). What follows is the **credential**
setup — the only remaining piece — done once per platform.

Until Android FCM is configured, the app still runs fine: push registration fails soft,
so you get in-app notifications (the 🔔 inbox) but no lock-screen banners.

---

## iOS — nothing to do (once enrolled)

EAS generates and manages the **APNs key** automatically the first time you run an iOS
build with a valid Apple Developer team. No files, no console steps.

---

## Android — FCM V1 (~15 minutes)

Expo requires **FCM V1**, which needs two separate things:
a `google-services.json` **in the app**, and a **service-account key on EAS**.

### Step 1 — Firebase: add the Android app *(you)*

1. Open the [Firebase console](https://console.firebase.google.com) and select the
   existing **Fame App** project (the one already used for Vision/Geocoding), or create
   a new one.
2. **Project settings → General → Your apps → Add app → Android**.
3. **Android package name** — must be exactly:
   ```
   com.phixr.app
   ```
   (Nickname and the debug signing certificate can be left blank.)
4. Download the generated **`google-services.json`**.

### Step 2 — Put the file where the build can see it *(either route)*

Save the downloaded file to the project root, then register it with EAS as a **file**
environment variable (the value is a path; EAS stores the contents and materialises the
file on the build machine):

```bash
eas env:create --environment production --name GOOGLE_SERVICES_JSON \
  --type file --value ./google-services.json --visibility sensitive --scope project
eas env:create --environment preview --name GOOGLE_SERVICES_JSON \
  --type file --value ./google-services.json --visibility sensitive --scope project
```

For **local** native runs, add the same line to `.env`:
```
GOOGLE_SERVICES_JSON=./google-services.json
```

`app.config.ts` reads that variable and omits the setting entirely when it is unset,
so builds stay green until the file exists.

### Step 3 — Give EAS the FCM V1 service-account key *(you)*

1. Firebase console → **Project settings → Service accounts**.
2. **Generate new private key** → downloads a `.json` file. **This one IS a secret** —
   do not commit it.
3. Upload it to EAS:
   ```bash
   eas credentials --platform android
   ```
   → select the **production** build profile
   → **Push Notifications: Manage your FCM V1 service account key**
   → **Set up a FCM V1 service account key** → point it at the downloaded `.json`.

### Step 4 — Rebuild

`google-services.json` is a **native** change, so OTA updates can't deliver it:

```bash
eas build --platform android --profile preview
```

### Step 5 — Verify end to end

1. Install the new APK, sign in, and allow notifications when prompted.
2. Confirm a token was stored — it should appear in the `push_tokens` table for your user.
3. Trigger a real notification from another account (follow the user, or comment on
   their post) and confirm the banner arrives with the app **closed**.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| No token registered on Android | `google-services.json` missing from the build, or notification permission denied |
| Token exists but no banner arrives | FCM V1 service-account key not uploaded to EAS (Step 3) |
| Works in-app, never on the lock screen | Same as above — the inbox is DB-driven and doesn't need FCM |
| Nothing on iOS Simulator | Expected: push requires a physical device |

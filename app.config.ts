import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * The static configuration lives in `app.json`; Expo passes it in as `config` and we
 * extend it here. This file's job is to inject runtime configuration from environment
 * variables so that secrets/keys are NEVER hardcoded in source control.
 *
 * Expo CLI automatically loads `.env` files into `process.env` before evaluating this
 * file, so `process.env.SUPABASE_URL` etc. resolve from your local `.env` (or from CI /
 * EAS environment variables in a build). The values are exposed to the app at runtime
 * through `expo-constants` (`Constants.expoConfig.extra`) — see `lib/supabase.ts`.
 *
 * Note: the Supabase anon key is a *publishable* client key (safe to ship in a client
 * bundle); it is only kept in env vars to avoid committing environment-specific values
 * and to keep the service-role key — which must NEVER reach the client — out of the app.
 */
/**
 * Android push (FCM) needs a `google-services.json` from the Firebase project, supplied
 * via GOOGLE_SERVICES_JSON — an EAS *file* environment variable, whose value is the path
 * to the file on the build machine (see docs/push-setup.md). When it is unset the key is
 * omitted entirely: the app still builds and runs, it just can't receive Android push.
 * Pointing `googleServicesFile` at a missing path would fail the build outright, which
 * is why this is conditional rather than hardcoded.
 */
const googleServices = process.env.GOOGLE_SERVICES_JSON
  ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
  : undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // `name`/`slug` are required by the ExpoConfig type; inherited from app.json.
  name: config.name ?? 'Phixr',
  slug: config.slug ?? 'phixr',
  android: {
    ...config.android,
    ...googleServices,
  },
  plugins: [
    ...(config.plugins ?? []),
    // Sentry's Expo config plugin: wires the native SDK and, at build time, uploads
    // source maps. `organization`/`project`/`authToken` come from env so nothing
    // Sentry-account-specific is committed.
    //
    // NOTE: leaving these unset does NOT skip the upload — the Gradle/Xcode hook still
    // shells out to sentry-cli, which exits 1 and fails the whole native build.
    //
    // SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN now exist as EAS environment
    // variables (the token is `secret`, readable only on the builder), so preview and
    // production upload source maps and report un-minified stack traces. The
    // `development` profile still sets SENTRY_DISABLE_AUTO_UPLOAD=true: simulator builds
    // don't need symbolication, and a local checkout has no token.
    [
      '@sentry/react-native/expo',
      {
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        // authToken is read from SENTRY_AUTH_TOKEN in the build env by the plugin.
      },
    ],
  ],
  extra: {
    ...config.extra,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    // Crash reporting + analytics keys (all publishable client keys). Empty → disabled.
    sentryDsn: process.env.SENTRY_DSN,
    posthogKey: process.env.POSTHOG_KEY,
    posthogHost: process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com',
  },
});

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
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // `name`/`slug` are required by the ExpoConfig type; inherited from app.json.
  name: config.name ?? 'Phixr',
  slug: config.slug ?? 'phixr',
  plugins: [
    ...(config.plugins ?? []),
    // Sentry's Expo config plugin: wires the native SDK and, at build time, uploads
    // source maps. `organization`/`project`/`authToken` come from env so nothing
    // Sentry-account-specific is committed. Harmless when unset (no upload configured).
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

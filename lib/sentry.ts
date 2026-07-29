/**
 * Crash reporting (Sentry) init. The PII scrubbers live in lib/sentry-scrub.ts (pure,
 * unit-testable in Node); this module wires them into the SDK.
 *
 *   - `sendDefaultPii: false`      — Sentry never attaches IP / cookies / headers itself
 *   - `beforeSend` → scrubEvent    — strips the event to {user.id} and redacts emails /
 *                                     JWTs / bearer tokens / signed-media URLs everywhere
 *   - `beforeBreadcrumb`           — redacts URLs (query strings carry access tokens) and
 *                                     route params that can carry @handles
 *
 * Native crash capture requires a dev/production build (JS-only in Expo Go); the
 * scrubbers run identically in both, so the payload contract holds.
 */
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

import { scrubBreadcrumb, scrubEvent } from '@/lib/sentry-scrub';
import type { AppExtra } from '@/types';

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

let started = false;

/**
 * Initialise Sentry once. No-ops (crash reporting stays off) when no DSN is set, so the
 * app runs unchanged without a Sentry account. `dsnOverride` lets the payload
 * verification harness point at a local capture server.
 */
export function initSentry(dsnOverride?: string): boolean {
  if (started) return true;
  const dsn = dsnOverride ?? extra.sentryDsn;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    sendDefaultPii: false, // never let Sentry attach IP / cookies / user data itself
    attachStacktrace: true,
    tracesSampleRate: 0.2,
    // No session replay / no profiling: both can capture screen content (photos, handles).
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  started = true;
  return true;
}

export { Sentry };

/**
 * Product analytics (PostHog) — privacy-first by construction.
 *
 * Hard rules from the spec, enforced HERE so no call site can break them:
 *   - NO PII in properties. `identify()` sends the user id ONLY (never email/handle).
 *   - Swipe attribution is NEVER sent. A swipe event carries `direction` but never a
 *     post id / recipient id, so PostHog can never reconstruct a post↔swiper pair.
 *   - An opt-out toggle in settings is honoured BEFORE any event fires: when opted out
 *     the client is never even constructed, so `capture()` is a no-op.
 *   - No autocapture, no session replay, no geo/IP (`disableGeoip`), so nothing is
 *     collected implicitly — only the explicit events below.
 *
 * Only a whitelist of property keys is allowed through, and every string value is
 * scrubbed for emails / URLs / tokens as a second line of defence. This is what the
 * payload-verification harness asserts against.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { PostHog } from 'posthog-react-native';

import { sanitizeProps, type Props } from '@/lib/analytics-scrub';
import type { AppExtra } from '@/types';

export { sanitizeProps } from '@/lib/analytics-scrub';

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

const OPT_OUT_KEY = 'fame.analytics.optOut';
const FIRST_KEY = (userId: string, name: string) => `fame.analytics.first.${userId}.${name}`;

/** Milestone (once) + deck (repeating) events. Exhaustive — call sites use these only. */
export type AnalyticsEvent =
  | 'signup_started'
  | 'email_verified'
  | 'onboarding_tags_complete'
  | 'onboarding_follows_complete'
  | 'first_swipe'
  | 'first_comment'
  | 'first_post'
  | 'first_share'
  | 'session_start'
  | 'swipe'
  | 'undo_used'
  | 'deck_exhausted'
  | 'batch_refetch';

let client: PostHog | null = null;
let optedOut = false;
let initialised = false;

export const analytics = {
  /**
   * Load the opt-out preference, then construct the client only if the user is opted in
   * and a key exists. Safe to call more than once. `keyOverride`/`hostOverride` let the
   * verification harness point at a local capture server.
   */
  async init(keyOverride?: string, hostOverride?: string): Promise<boolean> {
    if (initialised) return client !== null;
    initialised = true;
    optedOut = (await AsyncStorage.getItem(OPT_OUT_KEY)) === '1';
    const key = keyOverride ?? extra.posthogKey;
    const host = hostOverride ?? extra.posthogHost ?? 'https://eu.i.posthog.com';
    if (!key || optedOut) return false; // opted out → client never exists → no events
    client = new PostHog(key, {
      host,
      disableGeoip: true, // no IP-based location on any event
      defaultOptIn: true,
      captureAppLifecycleEvents: false, // no implicit app-open/background events
      preloadFeatureFlags: false,
      persistence: 'file',
    });
    return true;
  },

  /** Associate subsequent events with the user id ONLY — never email/handle/name. */
  identify(userId: string) {
    if (!client || optedOut) return;
    client.identify(userId); // no person properties by design
  },

  /** Clear identity on sign-out so the next user isn't merged into this one. */
  reset() {
    client?.reset();
  },

  /** Capture an event. Properties are whitelisted + scrubbed before they leave. */
  capture(event: AnalyticsEvent, props?: Props) {
    if (!client || optedOut) return;
    client.capture(event, sanitizeProps(props));
  },

  /** True the first time this (user, name) pair is seen on this device; false after. */
  async firstTime(userId: string, name: string): Promise<boolean> {
    if (!userId) return false;
    const k = FIRST_KEY(userId, name);
    if (await AsyncStorage.getItem(k)) return false;
    await AsyncStorage.setItem(k, '1');
    return true;
  },

  /** Settings toggle. Opting out tears the client down immediately. */
  async setOptOut(value: boolean): Promise<void> {
    optedOut = value;
    await AsyncStorage.setItem(OPT_OUT_KEY, value ? '1' : '0');
    if (value) {
      await client?.optOut();
      await client?.flush().catch(() => {});
      client = null;
    } else if (!client && extra.posthogKey) {
      initialised = false;
      await analytics.init();
    }
  },

  isOptedOut() {
    return optedOut;
  },

  async flush() {
    await client?.flush().catch(() => {});
  },
};

/** Fire a milestone/deck event. */
export function track(event: AnalyticsEvent, props?: Props) {
  analytics.capture(event, props);
}

/** Fire an event only the first time it happens for this user on this device. */
export async function trackFirst(userId: string, event: AnalyticsEvent, props?: Props) {
  if (await analytics.firstTime(userId, event)) analytics.capture(event, props);
}

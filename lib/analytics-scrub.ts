/**
 * Pure property sanitiser for analytics events. No React Native imports, so it can be
 * unit-tested in Node against the exact objects that would be sent to PostHog.
 *
 * Two guarantees enforced here (not at the call sites):
 *   - Only whitelisted keys leave the device. A post id / recipient id / email / handle
 *     passed by mistake is silently dropped — so no swipe↔post pair or PII can ever be
 *     transmitted.
 *   - String values that still look like PII (email / JWT / URL) are dropped entirely.
 */
export type Props = Record<string, string | number | boolean>;

/** The ONLY property keys allowed to leave the device. */
export const ALLOWED_PROP_KEYS = new Set([
  'direction', // 'left' | 'right' — aggregate behaviour, never with a post id
  'deck', // 'home' | 'following'
  'count',
  'size',
  'tag_count',
  'index',
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const URLISH = /^https?:\/\//i;

/** Enforce the whitelist + reject any string value that looks like PII. */
export function sanitizeProps(props?: Props): Props | undefined {
  if (!props) return undefined;
  const out: Props = {};
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_PROP_KEYS.has(k)) continue;
    if (typeof v === 'string' && (EMAIL.test(v) || JWT.test(v) || URLISH.test(v))) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

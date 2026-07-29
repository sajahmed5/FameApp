/**
 * Pure PII-scrubbing logic for crash reports. No React Native / Expo imports (only
 * types, which erase at runtime) so it can be unit-tested in plain Node against the
 * exact payloads the SDK will serialize. Wired into Sentry via lib/sentry.ts.
 */
import type * as Sentry from '@sentry/react-native';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER = /[Bb]earer\s+[A-Za-z0-9._~+/=-]+/g;

/** Keys whose entire value is dropped regardless of content. */
export const SENSITIVE_KEY =
  /(pass(word)?|token|secret|authorization|api[-_]?key|cookie|session|jwt|refresh|access[-_]?token|email|phone|dob|date_of_birth|avatar_url|media_url|thumbnail_url|signed_url)/i;

/** Redact tokens embedded in a URL (query string) or a private-storage/signed path. */
export function redactUrl(value: string): string {
  try {
    const u = new URL(value);
    if (/\/storage\/|\/object\/(sign|authenticated)\//.test(u.pathname) || u.searchParams.has('token')) {
      return `${u.origin}/[media]`;
    }
    return `${u.origin}${u.pathname}`;
  } catch {
    return value;
  }
}

/** Redact sensitive substrings inside a free-text string. */
export function redactString(s: string): string {
  let out = s.replace(EMAIL, '[email]').replace(JWT, '[jwt]').replace(BEARER, 'Bearer [redacted]');
  if (/^https?:\/\//i.test(out.trim())) out = redactUrl(out.trim());
  return out;
}

/** Recursively scrub an arbitrary value: drop sensitive keys, redact strings. */
export function scrub<T>(value: T, depth = 0): T {
  if (depth > 8 || value == null) return value;
  if (typeof value === 'string') return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1)) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

/** Reduce a Sentry user object to just its id (no email / username / ip). */
export function scrubUser(user: Sentry.User | undefined): { id: string } | undefined {
  const id = user?.id;
  return id ? { id: String(id) } : undefined;
}

/** beforeSend: strip identifying context and redact PII everywhere in the event. */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  event.user = scrubUser(event.user);
  delete event.server_name;
  delete event.request; // headers/cookies/query can all carry tokens
  if (event.message) event.message = redactString(event.message);
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((b): b is Sentry.Breadcrumb => b !== null);
  }
  if (event.extra) event.extra = scrub(event.extra);
  if (event.contexts) event.contexts = scrub(event.contexts);
  if (event.tags) event.tags = scrub(event.tags);
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) ex.value = redactString(ex.value);
    }
  }
  return event;
}

/** beforeBreadcrumb: redact URLs and route params; drop nothing structural. */
export function scrubBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (crumb.message) crumb.message = redactString(crumb.message);
  if (crumb.data) {
    const data = { ...crumb.data } as Record<string, unknown>;
    if (typeof data.url === 'string') data.url = redactUrl(data.url);
    if (typeof data.to === 'string') data.to = data.to.split('?')[0];
    if (typeof data.from === 'string') data.from = data.from.split('?')[0];
    crumb.data = scrub(data);
  }
  return crumb;
}

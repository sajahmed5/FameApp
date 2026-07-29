// Shared Sentry helper for all Edge Functions.
//
// Each function is otherwise self-contained (no import map), so this is the one module
// they all import to get error reporting. DSN comes from the function's Deno env
// (`supabase secrets set SENTRY_DSN=...`); with no DSN set this is entirely inert, so
// functions run unchanged locally and in CI.
//
// PII scrubbing: `sendDefaultPii: false` plus a `beforeSend` that drops the request
// object (headers carry the caller's JWT / apikey) and redacts emails / JWTs / bearer
// tokens anywhere in the event. Edge functions handle uploads and push payloads, so the
// same "nothing sensitive leaves" rule as the mobile client applies here.
import * as Sentry from 'npm:@sentry/deno@8.47.0';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER = /[Bb]earer\s+[A-Za-z0-9._~+/=-]+/g;

function redact(s: string): string {
  return s.replace(EMAIL, '[email]').replace(JWT, '[jwt]').replace(BEARER, 'Bearer [redacted]');
}

// deno-lint-ignore no-explicit-any
function scrub(value: any, depth = 0): any {
  if (depth > 8 || value == null) return value;
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /token|secret|authorization|api[-_]?key|cookie|email|jwt|password/i.test(k)
        ? '[redacted]'
        : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

let started = false;

/** Initialise Sentry once for this function invocation environment. No-op without a DSN. */
export function initSentry(fn: string): boolean {
  if (started) return true;
  const dsn = Deno.env.get('SENTRY_DSN');
  if (!dsn) return false;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    initialScope: { tags: { fn } },
    // deno-lint-ignore no-explicit-any
    beforeSend(event: any) {
      delete event.request;
      delete event.server_name;
      if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
      if (event.message) event.message = redact(event.message);
      if (event.extra) event.extra = scrub(event.extra);
      if (event.contexts) event.contexts = scrub(event.contexts);
      if (event.exception?.values) {
        for (const ex of event.exception.values) if (ex.value) ex.value = redact(ex.value);
      }
      return event;
    },
  });
  started = true;
  return true;
}

/** Report a caught error to Sentry (best-effort, flushes before returning). */
export async function reportError(e: unknown, context?: Record<string, string>): Promise<void> {
  if (!started) return;
  Sentry.captureException(e, context ? { tags: context } : undefined);
  await Sentry.flush(2000).catch(() => {});
}

/**
 * Wrap a `Deno.serve` handler so any UNCAUGHT throw is captured before it propagates.
 * Handled errors (the functions' own try/catch) should also call `reportError`.
 */
export function withSentry(
  fn: string,
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  initSentry(fn);
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (e) {
      await reportError(e, { fn });
      throw e;
    }
  };
}

// delete-account — full account erasure with NO orphaned storage.
//
// Deleting `auth.users` cascades every DB row (profiles → posts/comments/stories/
// messages/…), but storage objects are NOT cascaded — so this function first removes
// every object the user owns (keys are `{uid}/...`) from the media, media-staging,
// avatars, and exports buckets, THEN deletes the auth user.
//
// The `evidence` bucket is deliberately NOT touched: CSAM evidence copies are held under
// legal retention and are not user-erasable (spec §9).
//
// Two callers, one code path (so both erase identically):
//   - the user themselves, via their Authorization bearer token → deletes self;
//   - the admin dashboard, via the `x-admin-secret` header + `target_user_id` in the body.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

import { reportError, withSentry } from '../_shared/sentry.ts';

// Every bucket a user owns objects in, EXCEPT `evidence` (legal retention).
const USER_BUCKETS = ['media', 'media-staging', 'avatars', 'exports'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

function service() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Remove every object under the `{uid}/` prefix in one bucket. Returns the count removed. */
async function purgeBucket(svc: ReturnType<typeof service>, bucket: string, uid: string): Promise<number> {
  let removed = 0;
  let offset = 0;
  // Keys are flat under the uid prefix ({uid}/{id}.ext); page through them all.
  for (;;) {
    const { data, error } = await svc.storage.from(bucket).list(uid, { limit: 1000, offset });
    if (error) throw new Error(`list ${bucket}: ${error.message}`);
    if (!data || data.length === 0) break;
    const paths = data.map((f) => `${uid}/${f.name}`);
    const { error: rmErr } = await svc.storage.from(bucket).remove(paths);
    if (rmErr) throw new Error(`remove ${bucket}: ${rmErr.message}`);
    removed += paths.length;
    if (data.length < 1000) break;
    offset += 1000;
  }
  return removed;
}

Deno.serve(
  withSentry('delete-account', async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const svc = service();

    // Resolve the target user id: admin (secret + target) or self (bearer token).
    let uid: string | null = null;
    const adminSecret = Deno.env.get('DELETE_ADMIN_SECRET');
    const providedSecret = req.headers.get('x-admin-secret');
    let isAdmin = false;

    if (adminSecret && providedSecret && providedSecret === adminSecret) {
      isAdmin = true;
      const body = await req.json().catch(() => ({}));
      uid = typeof body.target_user_id === 'string' ? body.target_user_id : null;
    } else {
      const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
      if (!token) return json({ error: 'unauthorized' }, 401);
      const { data, error } = await svc.auth.getUser(token);
      if (error || !data.user) return json({ error: 'unauthorized' }, 401);
      uid = data.user.id;
    }
    if (!uid) return json({ error: 'no_target' }, 400);

    try {
      // 1. Purge every owned storage object BEFORE deleting the DB rows, so the keys are
      //    still enumerable (nothing is left orphaned once the profile row is gone).
      const deleted: Record<string, number> = {};
      for (const bucket of USER_BUCKETS) {
        deleted[bucket] = await purgeBucket(svc, bucket, uid);
      }

      // 2. Delete the auth user → cascades all DB rows.
      const { error: delErr } = await svc.auth.admin.deleteUser(uid);
      if (delErr) throw new Error(`delete user: ${delErr.message}`);

      return json({ ok: true, user_id: uid, by: isAdmin ? 'admin' : 'self', storage_removed: deleted });
    } catch (e) {
      console.error('[delete-account] failed:', e);
      await reportError(e, { fn: 'delete-account' });
      return json({ error: 'delete_failed', message: String(e instanceof Error ? e.message : e) }, 500);
    }
  }),
);

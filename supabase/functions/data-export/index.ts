// data-export — produces a user's data archive and returns it as a signed link.
//
// The archive is a single JSON file containing:
//   - `data`: profile, posts, comments, follows, etc. (via the existing export_my_data
//     RPC, run AS the user so RLS applies);
//   - `media`: a signed download URL for every media/avatar object the user owns.
// The archive is written to the private `exports` bucket under `{uid}/` and returned as a
// short-lived signed URL, so nothing is delivered inline.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

import { reportError, withSentry } from '../_shared/sentry.ts';

const MEDIA_BUCKETS = ['media', 'avatars'];
const MEDIA_LINK_TTL = 60 * 60 * 24 * 7; // 7 days for the individual media links
const ARCHIVE_LINK_TTL = 60 * 60 * 24; // 24h for the archive download link

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

Deno.serve(
  withSentry('data-export', async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'unauthorized' }, 401);

    const svc = service();
    const { data: userData, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !userData.user) return json({ error: 'unauthorized' }, 401);
    const uid = userData.user.id;

    try {
      // 1. Structured data — run the RPC as the user so RLS scopes it to their own rows.
      const asUser = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
      );
      const { data: exportData, error: rpcErr } = await asUser.rpc('export_my_data');
      if (rpcErr) throw new Error(`export_my_data: ${rpcErr.message}`);

      // 2. Every owned media object → a signed download URL.
      const media: { bucket: string; key: string; url: string }[] = [];
      for (const bucket of MEDIA_BUCKETS) {
        let offset = 0;
        for (;;) {
          const { data: files, error } = await svc.storage.from(bucket).list(uid, { limit: 1000, offset });
          if (error) throw new Error(`list ${bucket}: ${error.message}`);
          if (!files || files.length === 0) break;
          for (const f of files) {
            const key = `${uid}/${f.name}`;
            const { data: signed } = await svc.storage.from(bucket).createSignedUrl(key, MEDIA_LINK_TTL);
            if (signed?.signedUrl) media.push({ bucket, key, url: signed.signedUrl });
          }
          if (files.length < 1000) break;
          offset += 1000;
        }
      }

      // 3. Write the archive to the private exports bucket + return a signed link.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archiveKey = `${uid}/fame-export-${stamp}.json`;
      const archive = JSON.stringify({ generated_at: new Date().toISOString(), data: exportData, media }, null, 2);
      const { error: upErr } = await svc.storage
        .from('exports')
        .upload(archiveKey, new TextEncoder().encode(archive), { contentType: 'application/json', upsert: true });
      if (upErr) throw new Error(`upload archive: ${upErr.message}`);

      const { data: link, error: linkErr } = await svc.storage
        .from('exports')
        .createSignedUrl(archiveKey, ARCHIVE_LINK_TTL);
      if (linkErr || !link) throw new Error(`sign archive: ${linkErr?.message}`);

      return json({ ok: true, url: link.signedUrl, media_count: media.length, expires_in: ARCHIVE_LINK_TTL });
    } catch (e) {
      console.error('[data-export] failed:', e);
      await reportError(e, { fn: 'data-export' });
      return json({ error: 'export_failed', message: String(e instanceof Error ? e.message : e) }, 500);
    }
  }),
);

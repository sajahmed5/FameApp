// ============================================================================
// storage.ts — Supabase clients + bucket helpers.
//   * service client: privileged storage writes (bypasses RLS) for the pipeline.
//   * user client: bound to the caller's JWT, used ONLY to authenticate the
//     caller and to claim a rate-limit slot under their identity.
//
// STAGING_BUCKET is private; SERVING_BUCKET is private + RLS. Cleanup helpers
// make failures leave nothing orphaned.
// ============================================================================
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

export const STAGING_BUCKET = 'media-staging';
export const SERVING_BUCKET = 'media';

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

export function userClient(jwt: string): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
}

export async function putObject(
  svc: SupabaseClient, bucket: string, path: string, bytes: Uint8Array, contentType: string,
): Promise<void> {
  const { error } = await svc.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`storage upload ${bucket}/${path}: ${error.message}`);
}

export async function downloadObject(svc: SupabaseClient, bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await svc.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`storage download ${bucket}/${path}: ${error?.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Best-effort removal — used for cleanup on failure; never throws. */
export async function removeObjects(svc: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await svc.storage.from(bucket).remove(paths);
  } catch (e) {
    console.error(`[cleanup] failed to remove ${bucket}/${paths.join(',')}:`, e);
  }
}

/** Short-lived signed URL for immediate client preview (bucket is private). */
export async function signedUrl(svc: SupabaseClient, bucket: string, path: string, expiresIn = 3600): Promise<string | null> {
  const { data, error } = await svc.storage.from(bucket).createSignedUrl(path, expiresIn);
  return error ? null : (data?.signedUrl ?? null);
}

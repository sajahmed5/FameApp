import * as Application from 'expo-application';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { Sentry } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';

export type FeedbackKind = 'bug' | 'idea' | 'other';

/** Most reports need one or two images; the cap keeps uploads quick on mobile data. */
export const MAX_ATTACHMENTS = 4;

export type SubmittedFeedback = {
  ref: number;
  /** How many attachments couldn't be uploaded — the report still saved. Surfaced in
   *  the UI so a silent failure can't go unnoticed again. */
  failedAttachments: number;
};

/**
 * File a product issue report. Optionally uploads a screenshot of the screen the
 * reporter was looking at (captured BEFORE the report sheet opened, so it shows the
 * problem rather than the report form).
 *
 * Returns the report's short `ref` so the UI can tell the user "reported as #121".
 */
export async function submitFeedback(input: {
  kind: FeedbackKind;
  message: string;
  route?: string | null;
  /** data: / file: URIs of the images to attach, in the order the reporter added them. */
  screenshotUris?: string[];
}): Promise<SubmittedFeedback> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Not signed in.');

  const uris = (input.screenshotUris ?? []).slice(0, MAX_ATTACHMENTS);
  // Uploaded in parallel, but a failure only drops that one image — losing an
  // attachment must never lose the written report.
  const settled = await Promise.all(
    uris.map((uri) =>
      uploadScreenshot(uid, uri).then(
        (key) => key,
        (e: unknown) => {
          // Instrumented deliberately: this failed twice with no way to see why, and
          // the reporter only ever saw "couldn't be uploaded". Scheme only — the rest
          // of the path contains the reporter's user id.
          Sentry.captureException(e instanceof Error ? e : new Error(String(e)), {
            tags: { area: 'feedback-attachment' },
            extra: { scheme: uri.split(':')[0]?.slice(0, 12) ?? 'none' },
          });
          return null;
        },
      ),
    ),
  );
  const paths = settled.filter((k): k is string => !!k);
  const failedAttachments = settled.length - paths.length;

  const { data, error } = await supabase
    .from('feedback_reports')
    .insert({
      user_id: uid,
      kind: input.kind,
      message: input.message.trim(),
      screenshot_paths: paths,
      // Mirrors the first attachment so the admin portal keeps working pre-update.
      screenshot_path: paths[0] ?? null,
      route: input.route ?? null,
      platform: Platform.OS,
      app_version: Application.nativeApplicationVersion ?? null,
    })
    .select('ref')
    .single();
  if (error) throw error;
  return { ref: (data as { ref: number }).ref, failedAttachments };
}

/**
 * Read a local capture or picked photo into bytes.
 *
 * `fetch()` is only right for the web's data: URIs. On native, captureScreen hands back
 * a filesystem path that may have no URI scheme at all, and fetch() rejects that
 * outright — which is why every native attachment failed even after the Blob fix.
 * expo-file-system reads the file directly and doesn't care about the scheme.
 */
async function readAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  if (uri.startsWith('data:')) return (await fetch(uri)).arrayBuffer();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : `file://${uri}`;
  return new File(withScheme).arrayBuffer();
}

/** Upload the capture to the private `feedback` bucket under the reporter's folder. */
async function uploadScreenshot(uid: string, uri: string): Promise<string> {
  // `arrayBuffer()`, NOT `blob()`. On React Native a Blob is an opaque handle backed by
  // a blob id, which the storage client can't serialise — a blob upload lands empty.
  const bytes = await readAsArrayBuffer(uri);
  if (bytes.byteLength === 0) throw new Error('Screenshot was empty.');
  const png = uri.startsWith('data:image/png') || uri.toLowerCase().endsWith('.png');
  const key = `${uid}/${Date.now()}.${png ? 'png' : 'jpg'}`;
  const { error } = await supabase.storage
    .from('feedback')
    .upload(key, bytes, { contentType: png ? 'image/png' : 'image/jpeg', upsert: false });
  if (error) throw error;
  return key;
}

export type MyFeedback = {
  ref: number;
  kind: FeedbackKind;
  message: string;
  status: 'new' | 'triaged' | 'in_progress' | 'fixed' | 'wont_fix';
  admin_note: string | null;
  created_at: string;
};

/** My own reports, so a reporter can see what happened to them. */
export async function getMyFeedback(): Promise<MyFeedback[]> {
  const { data, error } = await supabase
    .from('feedback_reports')
    .select('ref, kind, message, status, admin_note, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MyFeedback[];
}

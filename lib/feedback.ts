import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export type FeedbackKind = 'bug' | 'idea' | 'other';

export type SubmittedFeedback = { ref: number };

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
  /** data: URI or file URI of the screenshot, if the reporter chose to include one. */
  screenshotUri?: string | null;
}): Promise<SubmittedFeedback> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('Not signed in.');

  let screenshot_path: string | null = null;
  if (input.screenshotUri) {
    // Best-effort: a failed screenshot upload must never lose the written report.
    try {
      screenshot_path = await uploadScreenshot(uid, input.screenshotUri);
    } catch {
      screenshot_path = null;
    }
  }

  const { data, error } = await supabase
    .from('feedback_reports')
    .insert({
      user_id: uid,
      kind: input.kind,
      message: input.message.trim(),
      screenshot_path,
      route: input.route ?? null,
      platform: Platform.OS,
      app_version: Application.nativeApplicationVersion ?? null,
    })
    .select('ref')
    .single();
  if (error) throw error;
  return { ref: (data as { ref: number }).ref };
}

/** Upload the capture to the private `feedback` bucket under the reporter's folder. */
async function uploadScreenshot(uid: string, uri: string): Promise<string> {
  const res = await fetch(uri);
  const blob = await res.blob();
  const ext = blob.type.includes('png') ? 'png' : 'jpg';
  const key = `${uid}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('feedback')
    .upload(key, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
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

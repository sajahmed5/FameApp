import { supabase } from '@/lib/supabase';

/**
 * Fire-and-forget point awards for actions that aren't already awarded server-side
 * (swipes/comments go through their own RPCs). Every reason is capped server-side
 * (daily ceiling + per-reason caps), so extra calls are harmless — never block the UI
 * on these or surface errors.
 */
export function awardShare(postId: string): void {
  void supabase.rpc('award_share', { _post_id: postId }).then(
    () => {},
    () => {},
  );
}

/** Award for starting/participating in a conversation (capped ~5/day server-side). */
export function awardMessageActivity(conversationId: string): void {
  void supabase.rpc('award_message_activity', { _conversation_id: conversationId }).then(
    () => {},
    () => {},
  );
}

/** Award the once-per-day "active day" bonus. Safe to call on every app open. */
export function awardActiveDay(): void {
  void supabase.rpc('award_active_day').then(
    () => {},
    () => {},
  );
}

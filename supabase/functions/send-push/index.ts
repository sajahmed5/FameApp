// ============================================================================
// send-push — Edge Function invoked by the notifications dispatch trigger
// (pg_net) with { notification_id }. It:
//   1. verifies the webhook secret (only the DB trigger may call it),
//   2. loads the notification + recipient,
//   3. RESPECTS the per-category notification preference SERVER-SIDE (a disabled
//      category is never delivered, regardless of the client UI),
//   4. sends an Expo push to each of the recipient's device tokens with the
//      correct deep-link data + badge count,
//   5. cleans up tokens Expo reports as DeviceNotRegistered (revoked tokens).
//
// It never sends anything derived from a swipe — those never create a
// notification in the first place (see the migration; no trigger on swipes).
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

import { reportError, withSentry } from '../_shared/sentry.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// notification type → preference category. 'moderation' has no toggle (always sent).
const CATEGORY: Record<string, string | null> = {
  new_follower: 'follows',
  follow_accepted: 'follows',
  follow_request: 'requests',
  comment: 'comments',
  reply: 'comments',
  comment_reaction: 'reactions',
  reach_milestone: 'reach',
  message: 'messages',
  moderation: null,
};

type Notification = {
  id: string; user_id: string; type: string; actor_id: string | null;
  post_id: string | null; comment_id: string | null; count: number; payload: Record<string, unknown>;
};

Deno.serve(withSentry('send-push', async (req) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });

  // Only the DB dispatch trigger may call this.
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '';
  if (!secret || req.headers.get('x-webhook-secret') !== secret) {
    return new Response('unauthorized', { status: 401 });
  }

  let notificationId: string;
  try {
    notificationId = (await req.json()).notification_id;
    if (!notificationId) throw new Error('missing id');
  } catch {
    return new Response('bad_request', { status: 400 });
  }

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: notif } = await svc.from('notifications').select('*').eq('id', notificationId).single<Notification>();
  if (!notif) return json({ skipped: 'not_found' });

  // ---- server-side preference enforcement ----
  const category = CATEGORY[notif.type];
  if (category) {
    const { data: pref } = await svc.from('notification_prefs').select('prefs').eq('user_id', notif.user_id).maybeSingle();
    const prefs = (pref?.prefs ?? {}) as Record<string, boolean>;
    if (prefs[category] === false) return json({ skipped: 'category_disabled' });
  }

  // ---- recipient's device tokens + badge ----
  const { data: tokens } = await svc.from('push_tokens').select('token').eq('user_id', notif.user_id);
  if (!tokens?.length) return json({ skipped: 'no_tokens' });

  const { count: badge } = await svc
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', notif.user_id)
    .is('read_at', null);

  // actor handle for the message body
  let actor = '';
  if (notif.actor_id) {
    const { data: a } = await svc.from('profiles').select('handle').eq('id', notif.actor_id).maybeSingle();
    actor = a?.handle ?? '';
  }
  const { title, body } = compose(notif, actor);

  const messages = tokens.map((t) => ({
    to: t.token,
    title,
    body,
    sound: 'default',
    badge: typeof badge === 'number' ? badge : undefined,
    data: { type: notif.type, post_id: notif.post_id, comment_id: notif.comment_id, actor, notification_id: notif.id, conversation_id: notif.payload?.conversation_id ?? null },
  }));

  // ---- send via Expo, then reap revoked tokens ----
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(messages),
    });
    const out = await res.json().catch(() => ({}));
    const tickets: { status?: string; details?: { error?: string } }[] = out?.data ?? [];
    const dead: string[] = [];
    tickets.forEach((tk, i) => {
      if (tk?.details?.error === 'DeviceNotRegistered') dead.push(tokens[i].token);
    });
    if (dead.length) await svc.from('push_tokens').delete().in('token', dead);
    return json({ sent: messages.length, pruned: dead.length });
  } catch (e) {
    console.error('[send-push] expo error', e);
    await reportError(e);
    return json({ error: 'send_failed' }, 502);
  }
}));

function compose(n: Notification, actor: string): { title: string; body: string } {
  const at = actor ? `@${actor}` : 'Someone';
  switch (n.type) {
    case 'new_follower': return { title: 'New follower', body: `${at} started following you` };
    case 'follow_request': return { title: 'Follow request', body: `${at} wants to follow you` };
    case 'follow_accepted': return { title: 'Request accepted', body: `${at} accepted your follow request` };
    case 'comment': return { title: 'New comment', body: n.count > 1 ? `${n.count} new comments on your post` : `${at} commented on your post` };
    case 'reply': return { title: 'New reply', body: n.count > 1 ? `${n.count} new replies to your comment` : `${at} replied to your comment` };
    case 'comment_reaction': return { title: 'New reaction', body: `${at} reacted ${n.payload.emoji ?? ''} to your comment` };
    case 'reach_milestone': return { title: 'Your post is taking off 🎉', body: `Your post has reached ${fmt(n.payload.milestone)}+ people` };
    case 'message': return { title: at, body: n.count > 1 ? `${n.count} new messages` : 'Sent you a message' };
    case 'moderation': return moderationMsg(String(n.payload.status ?? ''));
    default: return { title: 'Fame', body: 'You have a new notification' };
  }
}

function moderationMsg(status: string): { title: string; body: string } {
  if (status === 'approved') return { title: 'Your post is live', body: 'Your post passed review and is now visible.' };
  if (status === 'flagged') return { title: 'Post under review', body: 'Your post is being reviewed and isn’t visible to others yet.' };
  if (status === 'removed') return { title: 'Post removed', body: 'One of your posts was removed for breaking our guidelines.' };
  return { title: 'Moderation update', body: 'There’s an update on one of your posts.' };
}

function fmt(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : String(v ?? '');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

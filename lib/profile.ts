import { signMediaPaths } from '@/lib/media';
import { supabase } from '@/lib/supabase';

export type ProfileOverview = {
  id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  is_private: boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
  is_self: boolean;
  follow_status: 'pending' | 'accepted' | null;
  is_blocked: boolean;
  is_muting: boolean;
  locked: boolean;
};

export type GridPost = {
  id: string;
  thumbnail_url: string; // signed
  media_type: 'image' | 'video';
  visibility: 'public' | 'private';
  moderation_status: 'approved' | 'flagged' | 'pending' | 'removed';
  /** Total media items (1 = single, >1 = carousel), for the grid's stacked badge. */
  media_count?: number;
};

export async function getProfileOverview(handle: string): Promise<ProfileOverview | null> {
  const { data, error } = await supabase.rpc('get_profile_overview', { _handle: handle });
  if (error) throw error;
  return (data?.[0] as ProfileOverview) ?? null;
}

/**
 * Posts for the grid. Queried directly so the posts RLS applies — a private post
 * is returned only to the owner and accepted followers (see the runtime check in
 * verify_profile.js). Thumbnails are signed for the private `media` bucket.
 */
export async function getProfilePosts(userId: string): Promise<GridPost[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('id, thumbnail_url, media_type, visibility, moderation_status')
    .eq('user_id', userId)
    .neq('moderation_status', 'removed')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as GridPost[];
  const [signed, counts] = await Promise.all([
    signMediaPaths(rows.map((r) => r.thumbnail_url)),
    carouselCounts(rows.map((r) => r.id)),
  ]);
  return rows.map((r) => ({
    ...r,
    thumbnail_url: signed.get(r.thumbnail_url) ?? r.thumbnail_url,
    media_count: counts.get(r.id) ?? 1,
  }));
}

/**
 * Media count per post (1 = single, >1 = carousel) for the grid's stacked badge.
 * Never throws — a failure just means no badge.
 */
async function carouselCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from('post_media').select('post_id').in('post_id', ids);
  if (error || !data) return out;
  for (const row of data as { post_id: string }[]) {
    out.set(row.post_id, (out.get(row.post_id) ?? 1) + 1);
  }
  return out;
}

// ---- Relationships ---------------------------------------------------------

export async function followUser(target: ProfileOverview): Promise<'pending' | 'accepted'> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user!.id;
  // Always request; a DB trigger upgrades it to 'accepted' only when the target is
  // public AND has follower-approval turned off. The client never decides this.
  const { data, error } = await supabase
    .from('follows')
    .insert({ follower_id: uid, followee_id: target.id, status: 'pending' })
    .select('status')
    .single();
  if (error && error.code !== '23505') throw error;
  return ((data as { status?: string } | null)?.status as 'pending' | 'accepted') ?? 'pending';
}

/** Require new followers to be approved, even when the profile is public. */
export async function setFollowApproval(require: boolean): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('profiles')
    .update({ require_follow_approval: require })
    .eq('id', u.user!.id);
  if (error) throw error;
}

export async function unfollowUser(targetId: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', u.user!.id)
    .eq('followee_id', targetId);
  if (error) throw error;
}

export async function blockUser(targetId: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user!.id;
  // Blocking also drops any follow edges between the two.
  const { error } = await supabase.from('blocks').insert({ blocker_id: uid, blocked_id: targetId });
  if (error && error.code !== '23505') throw error;
  await supabase
    .from('follows')
    .delete()
    .or(
      `and(follower_id.eq.${uid},followee_id.eq.${targetId}),and(follower_id.eq.${targetId},followee_id.eq.${uid})`,
    );
}

/** Make someone stop following me (removes their follow edge). */
export async function removeFollower(followerId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_follower', { _follower: followerId });
  if (error) throw error;
}

/** Bulk-set the visibility of ALL my posts. Returns how many changed. */
export async function setAllPostsVisibility(visibility: 'public' | 'private'): Promise<number> {
  const { data, error } = await supabase.rpc('set_all_my_posts_visibility', { _visibility: visibility });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function unblockUser(targetId: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', u.user!.id)
    .eq('blocked_id', targetId);
  if (error) throw error;
}

export async function muteUser(targetId: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('mutes')
    .insert({ muter_id: u.user!.id, muted_id: targetId });
  if (error && error.code !== '23505') throw error;
}

export async function unmuteUser(targetId: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('mutes')
    .delete()
    .eq('muter_id', u.user!.id)
    .eq('muted_id', targetId);
  if (error) throw error;
}

export async function reportUser(targetId: string, reason: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('reports').insert({
    reporter_id: u.user!.id,
    target_type: 'user',
    target_id: targetId,
    reason,
  });
  if (error) throw error;
}

// ---- Follow requests -------------------------------------------------------

export type FollowRequest = {
  follower_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
};

export async function getFollowRequests(): Promise<FollowRequest[]> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('follows')
    .select(
      'follower_id, created_at, profiles!follows_follower_id_fkey(handle, display_name, avatar_url)',
    )
    .eq('followee_id', u.user!.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (
    (data ?? []) as unknown as {
      follower_id: string;
      created_at: string;
      profiles: { handle: string; display_name: string; avatar_url: string | null };
    }[]
  ).map((r) => ({ follower_id: r.follower_id, created_at: r.created_at, ...r.profiles }));
}

export async function getPendingRequestCount(): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  const { count, error } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('followee_id', u.user!.id)
    .eq('status', 'pending');
  if (error) return 0;
  return count ?? 0;
}

export async function acceptRequest(followerId: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('follows')
    .update({ status: 'accepted' })
    .eq('follower_id', followerId)
    .eq('followee_id', u.user!.id);
  if (error) throw error;
}

export async function rejectRequest(followerId: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('followee_id', u.user!.id);
  if (error) throw error;
}

// ---- Connection lists ------------------------------------------------------

export type Connection = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
};

export async function getConnections(
  userId: string,
  type: 'followers' | 'following',
): Promise<Connection[]> {
  const col = type === 'followers' ? 'followee_id' : 'follower_id';
  const otherCol = type === 'followers' ? 'follower_id' : 'followee_id';
  const rel =
    type === 'followers'
      ? 'profiles!follows_follower_id_fkey'
      : 'profiles!follows_followee_id_fkey';
  const { data, error } = await supabase
    .from('follows')
    .select(`${otherCol}, ${rel}(id, handle, display_name, avatar_url)`)
    .eq(col, userId)
    .eq('status', 'accepted');
  if (error) throw error;
  return ((data ?? []) as unknown as { profiles: Connection }[])
    .map((r) => r.profiles)
    .filter(Boolean);
}

export type BlockedMuted = { blocked: Connection[]; muted: Connection[] };

export async function getBlockedAndMuted(): Promise<BlockedMuted> {
  // Via a SECURITY DEFINER RPC — a client-side join to profiles is RLS-filtered, so
  // blocked/muted users (whose profiles aren't otherwise visible) would drop out.
  const { data, error } = await supabase.rpc('get_blocked_muted');
  if (error) throw error;
  const rows = (data ?? []) as ({ kind: 'block' | 'mute' } & Connection)[];
  const pick = (kind: 'block' | 'mute') =>
    rows.filter((r) => r.kind === kind).map(({ id, handle, display_name, avatar_url }) => ({ id, handle, display_name, avatar_url }));
  return { blocked: pick('block'), muted: pick('mute') };
}

// ---- Edit profile ----------------------------------------------------------

export async function updateOwnProfile(patch: {
  display_name?: string;
  bio?: string;
  avatar_url?: string;
}): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('profiles').update(patch).eq('id', u.user!.id);
  if (error) throw error;
}

export async function setPrivacy(isPrivate: boolean): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('profiles')
    .update({ is_private: isPrivate })
    .eq('id', u.user!.id);
  if (error) throw error;
}

export async function setSearchRadius(miles: number): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('profiles')
    .update({ search_radius_miles: miles })
    .eq('id', u.user!.id);
  if (error) throw error;
}

/** Mark the first-run tutorial finished so it never auto-shows again. */
export async function markTutorialComplete(): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('profiles')
    .update({ tutorial_complete: true })
    .eq('id', u.user!.id);
  if (error) throw error;
}

// ---- Analytics -------------------------------------------------------------

export type PostAnalytics = {
  reach: number;
  likes: number;
  skips: number;
  comments: number;
  shares: number;
  like_rate: number | null;
  skip_rate: number | null;
  sample_suppressed: boolean;
};
export async function getPostAnalytics(postId: string): Promise<PostAnalytics> {
  const { data, error } = await supabase.rpc('get_post_analytics', { _post_id: postId });
  if (error) throw error;
  return data![0] as PostAnalytics;
}

export type AccountAnalytics = {
  follower_count: number;
  post_count: number;
  total_reach: number;
  points_balance: number;
  points_lifetime: number;
  distribution_multiplier: number;
  follower_growth: { week: string; new_followers: number }[];
};
export async function getAccountAnalytics(): Promise<AccountAnalytics> {
  const { data, error } = await supabase.rpc('get_account_analytics');
  if (error) throw error;
  return data![0] as AccountAnalytics;
}

export type TagReach = {
  tag: string;
  posts: number;
  reach: number;
  likes: number;
  like_rate: number | null;
};
export async function getTagReach(): Promise<TagReach[]> {
  const { data, error } = await supabase.rpc('get_tag_reach');
  if (error) throw error;
  return (data ?? []) as TagReach[];
}

// ---- Settings actions ------------------------------------------------------

export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/**
 * Kick off a data export. The `data-export` Edge Function builds a JSON archive
 * (profile, posts, comments, follows) plus signed download links for every media object,
 * writes it to the private exports bucket, and returns a short-lived signed link.
 */
export async function requestDataExport(): Promise<{ url: string; mediaCount: number }> {
  const { data, error } = await supabase.functions.invoke('data-export', { body: {} });
  if (error) throw error;
  const res = data as { url?: string; media_count?: number; error?: string };
  if (!res?.url) throw new Error(res?.error ?? 'export_failed');
  return { url: res.url, mediaCount: res.media_count ?? 0 };
}

/**
 * Full account erasure. The `delete-account` Edge Function removes every storage object
 * the user owns (no orphans) and then deletes the auth user (cascading all DB rows);
 * CSAM evidence under legal retention is preserved. Then we sign out locally.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) throw error;
  await supabase.auth.signOut().catch(() => {});
}

/** Record the user's acceptance of a specific Terms/Privacy version (signup + re-accept). */
export async function acceptTerms(version: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  const { error } = await supabase
    .from('profiles')
    .update({ terms_version: version, terms_accepted_at: new Date().toISOString() })
    .eq('id', u.user.id);
  if (error) throw error;
}

/** Submit an appeal against a moderation action on the user's own content/account. */
export async function submitAppeal(
  targetType: 'post' | 'comment' | 'account',
  targetId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('submit_appeal', {
    _target_type: targetType,
    _target_id: targetId,
    _reason: reason,
  });
  if (error) throw error;
}

/** Sign out every OTHER device (keeps this session). Used by session management. */
export async function signOutOtherSessions(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) throw error;
}

/** Devices currently registered for push — a proxy "active devices" list for settings. */
export async function getActiveDevices(): Promise<{ id: string; platform: string; last_seen: string }[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const { data } = await supabase
    .from('push_tokens')
    .select('token, platform, updated_at')
    .eq('user_id', u.user.id)
    .order('updated_at', { ascending: false });
  return (data ?? []).map((d) => ({ id: d.token as string, platform: (d.platform as string) ?? 'device', last_seen: d.updated_at as string }));
}

export type NotificationPrefs = {
  follows: boolean;
  requests: boolean;
  comments: boolean;
  reactions: boolean;
  reach: boolean;
  messages: boolean;
};
const DEFAULT_PREFS: NotificationPrefs = {
  follows: true,
  requests: true,
  comments: true,
  reactions: true,
  reach: true,
  messages: true,
};

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const { data: u } = await supabase.auth.getUser();
  const { data } = await supabase
    .from('notification_prefs')
    .select('prefs')
    .eq('user_id', u.user!.id)
    .maybeSingle();
  return { ...DEFAULT_PREFS, ...((data?.prefs as Partial<NotificationPrefs>) ?? {}) };
}

export async function setNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('notification_prefs')
    .upsert({ user_id: u.user!.id, prefs, updated_at: new Date().toISOString() });
  if (error) throw error;
}

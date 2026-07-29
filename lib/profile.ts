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
  const signed = await signMediaPaths(rows.map((r) => r.thumbnail_url));
  return rows.map((r) => ({ ...r, thumbnail_url: signed.get(r.thumbnail_url) ?? r.thumbnail_url }));
}

// ---- Relationships ---------------------------------------------------------

export async function followUser(target: ProfileOverview): Promise<'pending' | 'accepted'> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user!.id;
  const status = target.is_private ? 'pending' : 'accepted';
  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: uid, followee_id: target.id, status });
  if (error && error.code !== '23505') throw error;
  return status;
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
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user!.id;
  const [b, m] = await Promise.all([
    supabase
      .from('blocks')
      .select('profiles!blocks_blocked_id_fkey(id, handle, display_name, avatar_url)')
      .eq('blocker_id', uid),
    supabase
      .from('mutes')
      .select('profiles!mutes_muted_id_fkey(id, handle, display_name, avatar_url)')
      .eq('muter_id', uid),
  ]);
  const pick = (rows: { profiles: Connection }[] | null) =>
    ((rows ?? []) as unknown as { profiles: Connection }[]).map((r) => r.profiles).filter(Boolean);
  return { blocked: pick(b.data as never), muted: pick(m.data as never) };
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

export async function exportMyData(): Promise<unknown> {
  const { data, error } = await supabase.rpc('export_my_data');
  if (error) throw error;
  return data;
}

export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_account');
  if (error) throw error;
  await supabase.auth.signOut().catch(() => {});
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

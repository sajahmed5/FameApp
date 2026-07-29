import { isStoragePath, signMediaPaths } from '@/lib/media';
import { startDirect, sendMessage } from '@/lib/messages';
import { supabase } from '@/lib/supabase';

export type RailItem = {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  has_story: boolean;
  has_unviewed: boolean;
  latest_at: string | null;
  is_self: boolean;
};

export type Story = {
  id: string;
  media_url: string;
  thumbnail_url: string;
  media_type: 'image' | 'video';
  overlay_text: string | null;
  created_at: string;
  expires_at: string;
  viewed: boolean;
  is_self: boolean;
};

export type StoryViewer = {
  viewer_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  viewed_at: string;
};

export async function getStoriesRail(): Promise<RailItem[]> {
  const { data, error } = await supabase.rpc('get_stories_rail');
  if (error) throw error;
  return (data ?? []) as RailItem[];
}

export async function getUserStories(userId: string): Promise<Story[]> {
  const { data, error } = await supabase.rpc('get_user_stories', { _user_id: userId });
  if (error) throw error;
  const stories = (data ?? []) as Story[];
  const paths = stories.flatMap((s) => [s.media_url, s.thumbnail_url]).filter((p) => p && isStoragePath(p));
  if (paths.length === 0) return stories;
  const signed = await signMediaPaths(paths);
  return stories.map((s) => ({
    ...s,
    media_url: signed.get(s.media_url) ?? s.media_url,
    thumbnail_url: signed.get(s.thumbnail_url) ?? s.thumbnail_url,
  }));
}

export async function markStoryViewed(storyId: string): Promise<void> {
  await supabase.rpc('mark_story_viewed', { _story_id: storyId });
}

export async function getStoryViewers(storyId: string): Promise<StoryViewer[]> {
  const { data, error } = await supabase.rpc('get_story_viewers', { _story_id: storyId });
  if (error) throw error;
  return (data ?? []) as StoryViewer[];
}

export async function createStory(
  mediaUrl: string,
  thumbnailUrl: string,
  mediaType: 'image' | 'video',
  durationSeconds?: number,
  overlay?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_story', {
    _media_url: mediaUrl,
    _thumbnail_url: thumbnailUrl,
    _media_type: mediaType,
    _duration_seconds: durationSeconds ?? null,
    _overlay: overlay ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Swipe-up reply: a direct message to the story's owner, referencing the story. */
export async function replyToStory(ownerId: string, text: string): Promise<void> {
  const cid = await startDirect(ownerId);
  await sendMessage(cid, { body: `↩️ Replied to your story: ${text}` });
}

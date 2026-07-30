import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { STORY_RING_SEEN } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { getUserStories } from '@/lib/stories';

/**
 * An {@link Avatar} that grows a story ring when the user has an active story —
 * bright (theme tint) for your own live story or a follow's unseen story, dimmed
 * to {@link STORY_RING_SEEN} once you've watched it. Tapping opens the viewer.
 * On a profile page this is how you jump into your own or a friend's story.
 */
export function StoryAvatar({
  userId,
  uri,
  name,
  handle,
  size = 84,
}: {
  userId: string;
  uri?: string | null;
  name?: string | null;
  handle?: string | null;
  size?: number;
}) {
  const theme = useTheme();
  const [ring, setRing] = useState<{ color: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void getUserStories(userId)
      .then((stories) => {
        if (!alive || stories.length === 0) return;
        const isSelf = stories.some((s) => s.is_self);
        const hasUnviewed = stories.some((s) => !s.viewed && !s.is_self);
        setRing({ color: isSelf || hasUnviewed ? theme.tint : STORY_RING_SEEN });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, theme.tint]);

  const avatar = <Avatar uri={uri} name={name} handle={handle} size={size} />;
  if (!ring) return avatar;

  const pad = 4;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/story/[userId]', params: { userId } })}
      accessibilityRole="button"
      accessibilityLabel={`View ${name || (handle ? `@${handle}` : 'this user')}'s story`}
      style={[
        styles.ring,
        { width: size + pad * 2, height: size + pad * 2, borderRadius: (size + pad * 2) / 2, borderColor: ring.color },
      ]}>
      {avatar}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 2.5 },
});

import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { formatCount } from '@/lib/format';
import type { ProfileOverview } from '@/lib/profile';

type Props = {
  profile: ProfileOverview;
  onPressFollowers: () => void;
  onPressFollowing: () => void;
  /** Action row (settings gear / follow button / overflow), rendered top-right + below. */
  action?: React.ReactNode;
};

export function ProfileHeader({ profile, onPressFollowers, onPressFollowing, action }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Avatar uri={profile.avatar_url} name={profile.display_name} handle={profile.handle} size={84} />
        <View style={styles.counts}>
          <Stat label="Posts" value={profile.post_count} />
          <Stat label="Followers" value={profile.follower_count} onPress={onPressFollowers} />
          <Stat label="Following" value={profile.following_count} onPress={onPressFollowing} />
        </View>
      </View>

      <View style={styles.identity}>
        <ThemedText type="subtitle">{profile.display_name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          @{profile.handle}
          {profile.is_private ? '  ·  Private' : ''}
        </ThemedText>
        {profile.bio ? (
          <ThemedText type="default" style={styles.bio}>
            {profile.bio}
          </ThemedText>
        ) : null}
      </View>

      {action}
    </View>
  );
}

function Stat({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  const content = (
    <View style={styles.stat}>
      <ThemedText type="subtitle">{formatCount(value)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.statPress}>
      {content}
    </Pressable>
  ) : (
    <View style={styles.statPress}>{content}</View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  avatar: { width: 84, height: 84, borderRadius: 42 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  counts: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  statPress: { flex: 1 },
  stat: { alignItems: 'center', gap: 2 },
  identity: { gap: 3 },
  bio: { marginTop: 4 },
});

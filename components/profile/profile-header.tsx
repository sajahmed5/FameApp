import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { BRAND } from '@/constants/config';
import { formatCount } from '@/lib/format';
import type { ProfileOverview } from '@/lib/profile';

type Props = {
  profile: ProfileOverview;
  onPressFollowers: () => void;
  onPressFollowing: () => void;
  /** Points balance to feature as the hero stat (own profile). Omit to keep the classic layout. */
  points?: number | null;
  onPressPoints?: () => void;
  /** Action row (settings gear / follow button / overflow), rendered top-right + below. */
  action?: React.ReactNode;
};

export function ProfileHeader({
  profile,
  onPressFollowers,
  onPressFollowing,
  points,
  onPressPoints,
  action,
}: Props) {
  const showPointsHero = points != null;

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Avatar uri={profile.avatar_url} name={profile.display_name} handle={profile.handle} size={84} />
        {showPointsHero ? (
          // Points are the headline. Posts/Followers/Following move to the compact row below.
          <Pressable
            onPress={onPressPoints}
            accessibilityRole="button"
            accessibilityLabel="View your points"
            style={styles.pointsHero}>
            <Ionicons name="sparkles" size={20} color={BRAND.accent} />
            <ThemedText type="title" style={[styles.pointsValue, { color: BRAND.accent }]}>
              {formatCount(points)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              points
            </ThemedText>
          </Pressable>
        ) : (
          <View style={styles.counts}>
            <Stat label="Posts" value={profile.post_count} />
            <Stat label="Followers" value={profile.follower_count} onPress={onPressFollowers} />
            <Stat label="Following" value={profile.following_count} onPress={onPressFollowing} />
          </View>
        )}
      </View>

      <View style={styles.identity}>
        <ThemedText type="subtitle">{profile.display_name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          @{profile.handle}
          {profile.is_private ? '  ·  Private' : ''}
        </ThemedText>
        {showPointsHero ? (
          <View style={styles.inlineStats}>
            <InlineStat value={profile.post_count} label="posts" />
            <ThemedText type="small" themeColor="textSecondary">·</ThemedText>
            <InlineStat value={profile.follower_count} label="followers" onPress={onPressFollowers} />
            <ThemedText type="small" themeColor="textSecondary">·</ThemedText>
            <InlineStat value={profile.following_count} label="following" onPress={onPressFollowing} />
          </View>
        ) : null}
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

/** Compact inline stat ("N label") shown next to the name; tappable for followers/following. */
function InlineStat({ value, label, onPress }: { value: number; label: string; onPress?: () => void }) {
  const content = (
    <ThemedText type="small" themeColor="textSecondary">
      <ThemedText type="smallBold">{formatCount(value)}</ThemedText> {label}
    </ThemedText>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button">
      {content}
    </Pressable>
  ) : (
    content
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  counts: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  statPress: { flex: 1 },
  stat: { alignItems: 'center', gap: 2 },
  pointsHero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  pointsValue: { fontSize: 40, lineHeight: 44 },
  identity: { gap: 3 },
  inlineStats: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 2 },
  bio: { marginTop: 4 },
});

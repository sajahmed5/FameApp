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
        {profile.bio ? (
          <ThemedText type="default" style={styles.bio}>
            {profile.bio}
          </ThemedText>
        ) : null}
      </View>

      {showPointsHero ? (
        <View style={styles.miniRow}>
          <MiniStat label="Posts" value={profile.post_count} />
          <MiniStat label="Followers" value={profile.follower_count} onPress={onPressFollowers} />
          <MiniStat label="Following" value={profile.following_count} onPress={onPressFollowing} />
        </View>
      ) : null}

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

/** Compact side-by-side stat used under the points hero. */
function MiniStat({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  const content = (
    <View style={styles.miniStat}>
      <ThemedText type="smallBold">{formatCount(value)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.miniPress}>
      {content}
    </Pressable>
  ) : (
    <View style={styles.miniPress}>{content}</View>
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
  bio: { marginTop: 4 },
  miniRow: { flexDirection: 'row', justifyContent: 'space-around' },
  miniPress: { flex: 1 },
  miniStat: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 5 },
});

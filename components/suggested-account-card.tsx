import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import type { SuggestedAccount } from '@/types';

type Props = {
  account: SuggestedAccount;
  thumbnails: string[];
  busy?: boolean;
  onToggleFollow: () => void;
};

function followLabel(status: SuggestedAccount['follow_status']): string {
  if (status === 'accepted') return 'Following';
  if (status === 'pending') return 'Requested';
  return 'Follow';
}

export function SuggestedAccountCard({ account, thumbnails, busy, onToggleFollow }: Props) {
  const theme = useTheme();
  const isFollowing = account.follow_status !== null;
  const label = followLabel(account.follow_status);

  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <View style={styles.headerRow}>
        {account.avatar_url ? (
          <Image source={{ uri: account.avatar_url }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View
            style={[
              styles.avatar,
              styles.avatarFallback,
              { backgroundColor: theme.backgroundSelected },
            ]}>
            <ThemedText type="default" style={{ color: theme.text }}>
              {account.display_name.slice(0, 1).toUpperCase()}
            </ThemedText>
          </View>
        )}

        <View style={styles.identity}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {account.display_name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            @{account.handle} · {account.follower_count}{' '}
            {account.follower_count === 1 ? 'follower' : 'followers'}
          </ThemedText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} ${account.handle}`}
          disabled={busy}
          onPress={onToggleFollow}
          style={({ pressed }) => [
            styles.followBtn,
            isFollowing
              ? { backgroundColor: theme.backgroundElement, borderColor: theme.border }
              : { backgroundColor: BRAND.accent, borderColor: BRAND.accent },
            { opacity: busy ? 0.5 : pressed ? 0.85 : 1 },
          ]}>
          <ThemedText
            type="small"
            style={{ color: isFollowing ? theme.text : BRAND.onAccent, fontWeight: '700' }}>
            {label}
          </ThemedText>
        </Pressable>
      </View>

      {thumbnails.length > 0 ? (
        <View style={styles.thumbs}>
          {thumbnails.slice(0, 3).map((uri, i) => (
            <Image
              key={`${account.id}-${i}`}
              source={{ uri }}
              style={[styles.thumb, { backgroundColor: theme.backgroundSelected }]}
              contentFit="cover"
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    flex: 1,
    gap: 2,
  },
  followBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    minWidth: 96,
    alignItems: 'center',
  },
  thumbs: {
    flexDirection: 'row',
    gap: 8,
  },
  thumb: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 10,
  },
});

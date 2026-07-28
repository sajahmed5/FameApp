import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export function UserRow({
  handle,
  displayName,
  avatarUrl,
  onPress,
  right,
}: {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  const theme = useTheme();
  const body = (
    <View style={styles.row}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
      ) : (
        <View
          style={[styles.avatar, styles.fallback, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold">{displayName.slice(0, 1).toUpperCase()}</ThemedText>
        </View>
      )}
      <View style={styles.text}>
        <ThemedText type="smallBold">{displayName}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          @{handle}
        </ThemedText>
      </View>
      {right}
    </View>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 1 },
  pressed: { opacity: 0.6 },
});

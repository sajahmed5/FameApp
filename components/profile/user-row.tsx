import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';

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
  const body = (
    <View style={styles.row}>
      <Avatar uri={avatarUrl} name={displayName} handle={handle} size={44} />
      <View style={styles.text}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {displayName}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
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
  text: { flex: 1, gap: 1 },
  pressed: { opacity: 0.6 },
});

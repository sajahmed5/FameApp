import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { useNotifications } from '@/lib/notifications-provider';

/** Header bell with an unread badge → opens the notifications inbox. */
export function NotificationBellButton() {
  const router = useRouter();
  const theme = useTheme();
  const { unread } = useNotifications();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      hitSlop={8}
      onPress={() => router.push('/notifications')}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Ionicons name="notifications-outline" size={22} color={theme.text} />
      {unread > 0 ? (
        <View style={styles.badge}>
          <ThemedText type="small" style={styles.badgeText}>
            {unread > 99 ? '99+' : unread}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 16 },
  pressed: { opacity: 0.5 },
  badge: {
    position: 'absolute',
    top: -2,
    right: 10,
    backgroundColor: BRAND.accent,
    borderRadius: 999,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: BRAND.onAccent, fontWeight: '700', fontSize: 10 },
});

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/** Header gear that opens Settings — top-right on the own-profile tab. */
export function SettingsGearButton() {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      hitSlop={8}
      onPress={() => router.push('/settings')}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Ionicons name="settings-outline" size={22} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 16 },
  pressed: { opacity: 0.5 },
});

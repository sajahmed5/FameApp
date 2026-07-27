import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * Header icon that routes to the (placeholder) search screen. Rendered top-right on the
 * Home, Following and Profile tabs — per the spec, search lives in the corner so the
 * horizontal swipe belongs entirely to the deck.
 */
export function HeaderSearchButton() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search"
      hitSlop={8}
      onPress={() => router.push('/search')}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Ionicons name="search" size={22} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 16,
  },
  pressed: {
    opacity: 0.5,
  },
});

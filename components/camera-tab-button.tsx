import { Ionicons } from '@expo/vector-icons';
import type { MouseEvent } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { BRAND } from '@/constants/config';

/**
 * Props are the subset of expo-router's tab `tabBarButton` props that we use. The layout
 * passes the full prop object via spread, so this stays compatible without importing the
 * (internal) navigation type.
 */
type CameraTabButtonProps = {
  onPress?: (e: MouseEvent<HTMLAnchorElement> | GestureResponderEvent) => void;
  accessibilityState?: { selected?: boolean };
};

/**
 * The visually-emphasised centre tab. Instead of a normal label+icon, it renders a
 * raised, filled accent circle so the Camera reads as the app's primary action.
 */
export function CameraTabButton({ onPress, accessibilityState }: CameraTabButtonProps) {
  const focused = accessibilityState?.selected ?? false;

  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Camera"
        accessibilityState={{ selected: focused }}
        onPress={onPress}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Ionicons name="camera" size={28} color={BRAND.onAccent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'box-none',
  },
  button: {
    top: -14,
    height: 58,
    width: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND.accent,
    ...Platform.select({
      web: { boxShadow: '0px 3px 6px rgba(0, 0, 0, 0.2)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
        elevation: 5,
      },
    }),
  },
  pressed: {
    opacity: 0.85,
  },
});

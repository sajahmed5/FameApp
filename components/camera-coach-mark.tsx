import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BRAND } from '@/constants/config';
import { dismissCameraCoach, isCameraCoachArmed, onCameraCoachChange } from '@/lib/coach-marks';

/**
 * A one-shot callout that points at the centre camera tab, nudging the user to make
 * their first post. Armed when the first-run tutorial finishes; dismissed on tap or once
 * a post is created. Rendered app-wide (next to the tab bar) but only visible while armed.
 */
export function CameraCoachMark() {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void isCameraCoachArmed().then((armed) => {
        if (active) setVisible(armed);
      });
    };
    refresh();
    const unsub = onCameraCoachChange(refresh);
    return () => {
      active = false;
      unsub();
    };
  }, []);

  if (!visible) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + 64 }]}
      accessibilityRole="alert">
      <Pressable
        onPress={() => void dismissCameraCoach()}
        style={[styles.bubble, { backgroundColor: BRAND.accent }]}
        accessibilityLabel="Got it">
        <Ionicons name="camera" size={16} color={BRAND.onAccent} />
        <ThemedText type="smallBold" style={{ color: BRAND.onAccent }}>
          Tap here to make your first post
        </ThemedText>
      </Pressable>
      <View style={[styles.pointer, { borderTopColor: BRAND.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});

import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * App-wide "you're offline" banner. Uses the already-installed NetInfo. Queued actions
 * (swipes) flush automatically on reconnect via lib/swipe-queue.ts; this is the visible
 * signal that the device is offline. Announced to screen readers as an alert.
 */
export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      // `isConnected === false` is a definite offline; null (unknown) is treated as online.
      setOffline(state.isConnected === false);
    });
    return () => unsub();
  }, []);

  if (!offline) return null;

  return (
    <View
      style={[styles.bar, { paddingTop: insets.top + 6 }]}
      accessibilityRole="alert"
      accessibilityLabel="You're offline. Changes will sync when you reconnect.">
      <Ionicons name="cloud-offline-outline" size={15} color="#fff" />
      <Text style={styles.text}>You&apos;re offline — changes will sync when you reconnect</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 6,
    paddingHorizontal: 12,
    backgroundColor: '#3A3A3C',
  },
  text: { color: '#fff', fontSize: 12, fontWeight: '600' },
});

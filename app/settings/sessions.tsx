import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { getActiveDevices, signOutOtherSessions } from '@/lib/profile';

/**
 * Devices & sessions. Lists the devices registered to the account (from push tokens — the
 * available proxy for "where you're signed in") and offers a one-tap revoke of every OTHER
 * session via Supabase's global-scope sign-out.
 */
export default function SessionsScreen() {
  const theme = useTheme();
  const [devices, setDevices] = useState<{ id: string; platform: string; last_seen: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setDevices(await getActiveDevices().catch(() => []));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-loader
    void load();
  }, [load]);

  const revokeOthers = async () => {
    const ok = await confirm(
      'Sign out other devices?',
      'This keeps you signed in here and signs out every other device.',
      'Sign out others',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await signOutOtherSessions();
      Alert.alert('Done', 'Other devices have been signed out.');
      void load();
    } catch {
      Alert.alert('Something went wrong', 'Could not sign out other devices. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: 'Devices & sessions' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          Devices signed in to your account. If you see one you don&apos;t recognise, sign out other
          devices and change your password.
        </ThemedText>

        <View style={[styles.card, { borderColor: theme.border }]}>
          {devices === null ? (
            <View style={styles.rowPad}>
              <ActivityIndicator color={theme.textSecondary} />
            </View>
          ) : devices.length === 0 ? (
            <View style={styles.rowPad}>
              <ThemedText type="small" themeColor="textSecondary">
                No other devices registered.
              </ThemedText>
            </View>
          ) : (
            devices.map((d) => (
              <View key={d.id} style={styles.row}>
                <Ionicons
                  name={d.platform === 'ios' ? 'logo-apple' : d.platform === 'android' ? 'logo-android' : 'globe-outline'}
                  size={20}
                  color={theme.text}
                />
                <View style={{ flex: 1 }}>
                  <ThemedText type="default">{platformLabel(d.platform)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Last active {new Date(d.last_seen).toLocaleDateString()}
                  </ThemedText>
                </View>
              </View>
            ))
          )}
        </View>

        <Pressable
          onPress={revokeOthers}
          disabled={busy}
          style={[styles.revoke, { borderColor: theme.danger }]}>
          {busy ? (
            <ActivityIndicator color={theme.danger} />
          ) : (
            <ThemedText type="default" style={{ color: theme.danger, fontWeight: '600' }}>
              Sign out of all other devices
            </ThemedText>
          )}
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

function platformLabel(p: string): string {
  if (p === 'ios') return 'iPhone / iPad';
  if (p === 'android') return 'Android device';
  if (p === 'web') return 'Web browser';
  return 'Device';
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, gap: 14 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowPad: { padding: 16 },
  revoke: { borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center' },
});

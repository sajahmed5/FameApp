import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/constants/config';
import { TERMS_VERSION } from '@/constants/legal';
import { acceptTerms } from '@/lib/profile';
import { useAuth } from '@/lib/auth-context';

/**
 * Re-acceptance gate, shown once when the Terms/Privacy version changes (auto-pushed from
 * the root navigator). Required — no dismiss without accepting.
 */
export default function AcceptTermsScreen() {
  const router = useRouter();
  const { reload } = useAuth();
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      await acceptTerms(TERMS_VERSION);
      reload();
      router.back();
    } catch {
      setBusy(false);
      Alert.alert('Something went wrong', 'Could not record your acceptance. Try again.');
    }
  };

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={styles.content}>
        <Ionicons name="document-text-outline" size={48} color={BRAND.accent} />
        <ThemedText type="title" style={styles.center}>
          We&apos;ve updated our terms
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
          Our Terms of Service and Privacy Policy have changed. Please review and accept
          them to keep using Fame.
        </ThemedText>
        <View style={styles.links}>
          <Pressable onPress={() => router.push('/legal/terms')}>
            <ThemedText type="link" style={{ color: BRAND.accent }}>
              Terms of Service
            </ThemedText>
          </Pressable>
          <Pressable onPress={() => router.push('/legal/privacy')}>
            <ThemedText type="link" style={{ color: BRAND.accent }}>
              Privacy Policy
            </ThemedText>
          </Pressable>
        </View>
      </View>
      <View style={styles.footer}>
        <Button title="I accept" onPress={accept} loading={busy} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  center: { textAlign: 'center' },
  links: { flexDirection: 'row', gap: 24, marginTop: 8 },
  footer: { padding: 24 },
});

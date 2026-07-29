import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/constants/config';

const SUPPORT_EMAIL = 'support@lovefame.co.uk';

/**
 * Recovery for a LOST EMAIL account (distinct from a forgotten password, which is handled
 * by the email reset link in (auth)/forgot-password).
 *
 * Fame deliberately does not collect a phone number (see the store-submission doc), so
 * there is no SMS second factor to fall back on. When someone can no longer access the
 * email on their account, recovery is support-mediated with identity verification — the
 * secure option that doesn't add a SIM-swappable recovery channel.
 */
export default function RecoverScreen() {
  const contact = () => {
    const subject = encodeURIComponent('Account recovery — lost email access');
    const body = encodeURIComponent(
      'I have lost access to the email on my Fame account.\n\n' +
        'My handle: @\nThe email I signed up with: \n\nPlease help me recover access.',
    );
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
  };

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: 'Account recovery' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Ionicons name="help-buoy-outline" size={44} color={BRAND.accent} />
        <ThemedText type="title">Lost access to your email?</ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          If you still have your email, you can reset your password from the login screen. If
          you&apos;ve lost access to the email address itself, we recover your account through
          support with an identity check.
        </ThemedText>
        <View style={styles.steps}>
          <Step n={1} text="Email support from any address you can access." />
          <Step n={2} text="Tell us your handle and the email you signed up with." />
          <Step n={3} text="We verify it's you, then help you move to a new email." />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          We don&apos;t use SMS recovery: a phone number is never collected, which removes a common
          account-takeover route.
        </ThemedText>
        <Button title="Contact support" onPress={contact} />
      </ScrollView>
    </ThemedView>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <ThemedText type="smallBold" style={{ color: '#fff' }}>
          {n}
        </ThemedText>
      </View>
      <ThemedText type="default" style={{ flex: 1 }}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 24, gap: 16 },
  steps: { gap: 12, marginVertical: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: BRAND.accent, alignItems: 'center', justifyContent: 'center' },
});

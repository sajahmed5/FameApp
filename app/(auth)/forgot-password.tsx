import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AuthScreen } from '@/components/ui/auth-screen';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { useAuth } from '@/lib/auth-context';
import { useCooldown } from '@/lib/use-cooldown';
import { validateEmail } from '@/lib/validation';

const RESET_COOLDOWN_SECONDS = 60;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { sendPasswordReset } = useAuth();
  const cooldown = useCooldown();

  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailError = touched ? validateEmail(email) : null;

  async function onSubmit() {
    setTouched(true);
    setError(null);
    if (validateEmail(email) || cooldown.active) return;

    setSubmitting(true);
    // redirectTo lets the emailed link reopen the app; completing the reset (setting a new
    // password from the deep link) is a follow-up task.
    const redirectTo = Linking.createURL('/reset-password');
    const { error: resetError } = await sendPasswordReset(email, redirectTo);
    setSubmitting(false);
    cooldown.start(RESET_COOLDOWN_SECONDS);

    if (resetError) {
      setError(resetError.message);
      return;
    }
    // Non-enumerating: don't reveal whether the address has an account.
    setSent(true);
  }

  return (
    <AuthScreen
      title="Reset password"
      subtitle="We'll email you a link to set a new password."
      onBack={() => router.back()}
      footer={
        <Button
          title={cooldown.active ? `Resend in ${cooldown.remaining}s` : 'Send reset link'}
          onPress={onSubmit}
          loading={submitting}
          disabled={cooldown.active}
        />
      }>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      {sent ? (
        <FormMessage tone="success">
          If an account exists for that address, a reset link is on its way. Check your inbox.
        </FormMessage>
      ) : null}

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        onBlur={() => setTouched(true)}
        error={emailError}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        inputMode="email"
        placeholder="you@example.com"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
      />

      <Pressable onPress={() => router.push('/recover')} style={styles.recoverLink}>
        <ThemedText type="linkPrimary">Lost access to your email?</ThemedText>
      </Pressable>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  recoverLink: { alignSelf: 'center', paddingVertical: 8 },
});

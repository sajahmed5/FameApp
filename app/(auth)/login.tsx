import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AuthScreen } from '@/components/ui/auth-screen';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/hooks/use-theme';
import { useCooldown } from '@/lib/use-cooldown';
import { validateEmail } from '@/lib/validation';

const RESEND_COOLDOWN_SECONDS = 60;

export default function LoginScreen() {
  const { signIn, resendVerification } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const cooldown = useCooldown();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);

  const emailError = touched.email ? validateEmail(email) : null;
  const passwordError = touched.password && !password ? 'Enter your password.' : null;

  async function onSubmit() {
    setTouched({ email: true, password: true });
    setFormError(null);
    setResendNote(null);
    if (validateEmail(email) || !password) return;

    setSubmitting(true);
    setUnverified(false);
    const { error } = await signIn(email, password);
    setSubmitting(false);

    if (!error) return; // guard in the root layout routes us onward

    const message = error.message.toLowerCase();
    if (message.includes('not confirmed') || message.includes('not verified')) {
      setUnverified(true);
      setFormError('Your email address is not verified yet.');
    } else if (message.includes('invalid login credentials')) {
      setFormError('Email or password is incorrect.');
    } else {
      setFormError(error.message);
    }
  }

  async function onResend() {
    if (cooldown.active) return;
    setResendNote(null);
    const { error } = await resendVerification(email);
    cooldown.start(RESEND_COOLDOWN_SECONDS);
    setResendNote(
      error ? `Couldn't resend: ${error.message}` : 'Verification email sent. Check your inbox.',
    );
  }

  return (
    <AuthScreen
      title="Welcome back"
      subtitle="Log in to your Fame account."
      footer={
        <>
          <Button title="Log in" onPress={onSubmit} loading={submitting} />
          <Link href="/(auth)/forgot-password" style={styles.forgot}>
            <ThemedText type="linkPrimary">Forgot password?</ThemedText>
          </Link>

          {/* Prominent, always-visible path to sign up — a labelled divider then an
              outlined accent button, so new users can't miss it. */}
          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
            <ThemedText type="small" themeColor="textSecondary">
              New to Fame?
            </ThemedText>
            <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
          </View>
          <Button
            title="Create an account"
            variant="outline"
            onPress={() => router.push('/(auth)/signup/account')}
          />
        </>
      }>
      {formError ? <FormMessage tone="error">{formError}</FormMessage> : null}

      {unverified ? (
        <View style={{ gap: 8 }}>
          <Button
            title={
              cooldown.active
                ? `Resend link in ${cooldown.remaining}s`
                : 'Resend verification email'
            }
            variant="secondary"
            onPress={onResend}
            disabled={cooldown.active}
          />
          {resendNote ? <FormMessage tone="info">{resendNote}</FormMessage> : null}
        </View>
      ) : null}

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        onBlur={() => setTouched((t) => ({ ...t, email: true }))}
        error={emailError}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        inputMode="email"
        placeholder="you@example.com"
        returnKeyType="next"
      />

      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        onBlur={() => setTouched((t) => ({ ...t, password: true }))}
        error={passwordError}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        placeholder="Your password"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  forgot: { alignSelf: 'center', paddingVertical: 2 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 2 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
});

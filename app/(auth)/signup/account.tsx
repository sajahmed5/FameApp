import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AuthScreen } from '@/components/ui/auth-screen';
import { Button } from '@/components/ui/button';
import { PasswordStrengthMeter } from '@/components/ui/password-strength-meter';
import { TextField } from '@/components/ui/text-field';
import { ThemedText } from '@/components/themed-text';
import { useSignup } from '@/lib/signup-context';
import { validateEmail, validatePassword, validatePasswordConfirm } from '@/lib/validation';

export default function SignupAccountScreen() {
  const router = useRouter();
  const { draft, update } = useSignup();

  const [email, setEmail] = useState(draft.email);
  const [password, setPassword] = useState(draft.password);
  const [confirm, setConfirm] = useState(draft.password);
  const [touched, setTouched] = useState<{
    email?: boolean;
    password?: boolean;
    confirm?: boolean;
  }>({});

  const emailError = touched.email ? validateEmail(email) : null;
  const passwordError = touched.password ? validatePassword(password) : null;
  const confirmError = touched.confirm ? validatePasswordConfirm(password, confirm) : null;

  function onContinue() {
    setTouched({ email: true, password: true, confirm: true });
    if (
      validateEmail(email) ||
      validatePassword(password) ||
      validatePasswordConfirm(password, confirm)
    ) {
      return;
    }
    // No auth user is created here — that happens after the DOB gate on the next screen.
    update({ email: email.trim(), password });
    router.push('/(auth)/signup/identity');
  }

  return (
    <AuthScreen
      title="Create your account"
      subtitle="Step 1 of 3 — your login details."
      onBack={() => router.back()}
      footer={
        <>
          <Button title="Continue" onPress={onContinue} />
          <View style={{ alignItems: 'center', paddingTop: 4 }}>
            <Link href="/(auth)/login">
              <ThemedText type="link" themeColor="textSecondary">
                Already have an account? <ThemedText type="linkPrimary">Log in</ThemedText>
              </ThemedText>
            </Link>
          </View>
        </>
      }>
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
      />

      <View style={{ gap: 8 }}>
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          error={passwordError}
          hint="At least 10 characters."
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          placeholder="Create a password"
        />
        <PasswordStrengthMeter password={password} />
      </View>

      <TextField
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
        error={confirmError}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder="Re-enter your password"
      />
    </AuthScreen>
  );
}

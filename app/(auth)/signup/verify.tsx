import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AuthScreen } from '@/components/ui/auth-screen';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { useAuth } from '@/lib/auth-context';
import { useSignup } from '@/lib/signup-context';
import { supabase } from '@/lib/supabase';
import { useCooldown } from '@/lib/use-cooldown';

const POLL_INTERVAL_MS = 5000;
const RESEND_COOLDOWN_SECONDS = 60;

export default function SignupVerifyScreen() {
  const router = useRouter();
  const { draft, reset } = useSignup();
  const { session, resendVerification } = useAuth();
  const cooldown = useCooldown();

  const email = draft.email || session?.user?.email || 'your email';
  const canPollSignIn = !!draft.password && !!draft.email;

  const [resendNote, setResendNote] = useState<{ tone: 'info' | 'error'; text: string } | null>(
    null,
  );

  // The confirmation email was just sent (by signUp) — start the resend cooldown.
  const startedCooldown = useRef(false);
  useEffect(() => {
    if (!startedCooldown.current) {
      startedCooldown.current = true;
      cooldown.start(RESEND_COOLDOWN_SECONDS);
    }
  }, [cooldown]);

  // Poll for verification. If we still hold the password (normal flow, no session yet), we
  // poll sign-in — it fails with "email not confirmed" until the link is clicked, then
  // succeeds and establishes the session. If we already have a session (unverified resume),
  // we refresh it to pick up the confirmed state. Either way the root guard routes onward.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (!active) return;
      try {
        if (canPollSignIn) {
          const { error } = await supabase.auth.signInWithPassword({
            email: draft.email,
            password: draft.password,
          });
          if (!error && active) {
            reset(); // clear the in-memory password; guard now routes to tabs
            return;
          }
        } else if (session) {
          await supabase.auth.refreshSession();
        }
      } catch {
        // swallow transient network errors and keep polling
      }
      if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPollSignIn, session]);

  async function onResend() {
    if (cooldown.active) return;
    setResendNote(null);
    const { error } = await resendVerification(email);
    cooldown.start(RESEND_COOLDOWN_SECONDS);
    setResendNote(
      error
        ? { tone: 'error', text: `Couldn't resend: ${error.message}` }
        : { tone: 'info', text: 'Sent. Check your inbox (and spam).' },
    );
  }

  function onUseDifferentEmail() {
    reset();
    router.replace('/(auth)/signup/account');
  }

  return (
    <AuthScreen
      title="Verify your email"
      subtitle={`We sent a confirmation link to ${email}. Tap it to continue — this screen updates automatically.`}
      footer={
        <>
          <Button
            title={cooldown.active ? `Resend link in ${cooldown.remaining}s` : 'Resend link'}
            variant="secondary"
            onPress={onResend}
            disabled={cooldown.active}
          />
          <Button title="Use a different email" variant="secondary" onPress={onUseDifferentEmail} />
        </>
      }>
      <View style={styles.waiting}>
        <ActivityIndicator color="#208AEF" />
        <ThemedText type="small" themeColor="textSecondary">
          Waiting for verification…
        </ThemedText>
      </View>

      {!canPollSignIn && !session ? (
        <FormMessage tone="info">Once you&apos;ve verified, head back to log in.</FormMessage>
      ) : null}

      {resendNote ? <FormMessage tone={resendNote.tone}>{resendNote.text}</FormMessage> : null}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});

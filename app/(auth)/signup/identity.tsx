import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { track } from '@/lib/analytics';
import { DateOfBirthField } from '@/components/date-of-birth-field';
import { ThemedText } from '@/components/themed-text';
import { AuthScreen } from '@/components/ui/auth-screen';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { BRAND } from '@/constants/config';
import { TERMS_VERSION } from '@/constants/legal';
import { useAuth } from '@/lib/auth-context';
import { useSignup } from '@/lib/signup-context';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/hooks/use-theme';
import { dobStatus, toIsoDate, validateDisplayName, validateHandleFormat } from '@/lib/validation';
import type { SignupIdentityMetadata } from '@/types';

type Availability = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'error';
/** Result of a completed availability check, tied to the handle it was run for. */
type CheckResult = { handle: string; result: 'available' | 'taken' | 'error' };

const HANDLE_DEBOUNCE_MS = 450;
const TODAY = new Date();

export default function SignupIdentityScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { draft, update, reset } = useSignup();
  const { session, reload } = useAuth();

  // Resume mode: the user is already authenticated (verified) but has no profile row.
  const isResume = !!session;
  const metadata = session?.user?.user_metadata as Partial<SignupIdentityMetadata> | undefined;

  const [displayName, setDisplayName] = useState(draft.displayName || metadata?.display_name || '');
  const [handle, setHandle] = useState(draft.handle || metadata?.handle || '');
  const [dob, setDob] = useState<Date | null>(
    draft.dateOfBirth
      ? new Date(`${draft.dateOfBirth}T00:00:00`)
      : metadata?.date_of_birth
        ? new Date(`${metadata.date_of_birth}T00:00:00`)
        : null,
  );

  const [touched, setTouched] = useState<{ name?: boolean; handle?: boolean; dob?: boolean }>({});
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Debounced live handle availability against profiles.handle (anon-callable RPC).
  // Only the async result is stored; the synchronous states below are derived.
  useEffect(() => {
    if (!handle || validateHandleFormat(handle)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('is_handle_available', { _handle: handle });
      if (cancelled) return;
      setCheckResult({ handle, result: error ? 'error' : data ? 'available' : 'taken' });
    }, HANDLE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle]);

  const availability: Availability = !handle
    ? 'idle'
    : validateHandleFormat(handle)
      ? 'invalid'
      : checkResult?.handle === handle
        ? checkResult.result
        : 'checking';

  const nameError = touched.name ? validateDisplayName(displayName) : null;
  const dobState = dob ? dobStatus(dob) : null;
  const dobError = touched.dob
    ? !dob
      ? 'Enter your date of birth.'
      : dobState === 'under13'
        ? 'You must be at least 13 to use Fame.'
        : null
    : null;

  const handleError =
    touched.handle && availability === 'invalid'
      ? validateHandleFormat(handle)
      : availability === 'taken'
        ? 'That handle is taken.'
        : availability === 'error'
          ? "Couldn't check that handle. Try again."
          : null;

  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const canSubmit =
    !validateDisplayName(displayName) &&
    availability === 'available' &&
    !!dob &&
    dobState !== 'under13' &&
    acceptedTerms;

  async function onSubmit() {
    setTouched({ name: true, handle: true, dob: true });
    setFormError(null);
    if (!canSubmit || !dob) return;

    const isoDob = toIsoDate(dob);
    const isPrivate = dobStatus(dob) === 'minor';

    setSubmitting(true);
    try {
      if (isResume && session) {
        // Verified but profile missing → create it directly (handle may have changed).
        const { error } = await supabase.from('profiles').insert({
          id: session.user.id,
          handle,
          display_name: displayName.trim(),
          date_of_birth: isoDob,
          is_private: isPrivate,
          terms_version: TERMS_VERSION,
          terms_accepted_at: new Date().toISOString(),
        });
        if (error) {
          if (error.code === '23505') setCheckResult({ handle, result: 'taken' });
          else setFormError(error.message);
          return;
        }
        reset();
        reload(); // auth context re-resolves the profile → routes to tabs
        return;
      }

      // Fresh signup: NOW create the auth user (after the under-13 gate), carrying the
      // identity in user_metadata so the profile can be created on verification.
      update({ displayName: displayName.trim(), handle, dateOfBirth: isoDob });
      const { data, error } = await supabase.auth.signUp({
        email: draft.email,
        password: draft.password,
        options: {
          emailRedirectTo: Linking.createURL('/'),
          data: {
            display_name: displayName.trim(),
            handle,
            date_of_birth: isoDob,
            terms_version: TERMS_VERSION,
            terms_accepted_at: new Date().toISOString(),
          } satisfies SignupIdentityMetadata,
        },
      });
      if (error) {
        if (error.message.toLowerCase().includes('already registered')) {
          setFormError('An account already exists for this email. Try logging in instead.');
        } else {
          setFormError(error.message);
        }
        return;
      }
      track('signup_started');
      if (data.session) {
        // Email confirmation is off → we're already signed in. Clear the in-memory
        // signup draft and let the root guard carry us on (profile → onboarding →
        // deck). A verify-email banner nudges them to confirm later.
        reset();
        router.replace('/');
      } else {
        // Confirmation required → wait on the "check your email" screen.
        router.replace('/(auth)/signup/verify');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen
      title={isResume ? 'Finish setting up' : 'Tell us about you'}
      subtitle={isResume ? 'Pick a handle to finish your profile.' : 'Step 2 of 3 — your identity.'}
      onBack={isResume ? undefined : () => router.back()}
      footer={
        <Button
          title={isResume ? 'Finish setup' : 'Create account'}
          onPress={onSubmit}
          loading={submitting}
        />
      }>
      {formError ? <FormMessage tone="error">{formError}</FormMessage> : null}

      <TextField
        label="Display name"
        value={displayName}
        onChangeText={setDisplayName}
        onBlur={() => setTouched((t) => ({ ...t, name: true }))}
        error={nameError}
        autoCapitalize="words"
        placeholder="Your name"
        maxLength={50}
      />

      <TextField
        label="Handle"
        value={handle}
        onChangeText={(v) => setHandle(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
        onBlur={() => setTouched((t) => ({ ...t, handle: true }))}
        error={handleError}
        hint={
          availability === 'available'
            ? 'Available'
            : '3–30 characters: lowercase letters, numbers, underscore.'
        }
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="yourhandle"
        maxLength={30}
        accessoryRight={<HandleStatus availability={availability} />}
      />

      <DateOfBirthField
        label="Date of birth"
        value={dob}
        onChange={setDob}
        onBlur={() => setTouched((t) => ({ ...t, dob: true }))}
        error={dobError}
        hint="You can't change this later."
        maximumDate={TODAY}
      />

      {dobState === 'under13' ? (
        <FormMessage tone="error">
          You need to be at least 13 years old to create a Fame account.
        </FormMessage>
      ) : dobState === 'minor' ? (
        <FormMessage tone="info">
          Because you are under 18, your account will be private by default. You can review this in
          settings later.
        </FormMessage>
      ) : null}

      <Pressable
        style={styles.termsRow}
        onPress={() => setAcceptedTerms((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acceptedTerms }}>
        <Ionicons
          name={acceptedTerms ? 'checkbox' : 'square-outline'}
          size={24}
          color={acceptedTerms ? BRAND.accent : theme.textSecondary}
        />
        <ThemedText type="small" style={styles.termsText}>
          I agree to the{' '}
          <ThemedText type="small" style={{ color: BRAND.accent }} onPress={() => router.push('/legal/terms')}>
            Terms of Service
          </ThemedText>{' '}
          and{' '}
          <ThemedText type="small" style={{ color: BRAND.accent }} onPress={() => router.push('/legal/privacy')}>
            Privacy Policy
          </ThemedText>
          .
        </ThemedText>
      </Pressable>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 4 },
  termsText: { flex: 1, lineHeight: 20 },
});

function HandleStatus({ availability }: { availability: Availability }) {
  const theme = useTheme();
  if (availability === 'checking')
    return <ActivityIndicator size="small" color={theme.textSecondary} />;
  if (availability === 'available')
    return <Ionicons name="checkmark-circle" size={22} color={theme.success} />;
  if (availability === 'taken' || availability === 'invalid')
    return <Ionicons name="close-circle" size={22} color={theme.danger} />;
  return null;
}

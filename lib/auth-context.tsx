import type { AuthError, Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { unregisterPushToken } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { ageBandFromDob } from '@/lib/validation';
import type { Profile, SignupIdentityMetadata } from '@/types';

/**
 * Drives root-layout routing:
 *   loading      — still resolving session or profile; show a splash
 *   signedOut    — no session; go to (auth)
 *   unverified   — session but email not confirmed; go to verification
 *   needsProfile — verified but no profiles row (abandoned signup); resume identity
 *   onboarding   — verified + profile, but onboarding not finished; run onboarding
 *   ready        — verified + profile + onboarding complete; go to (tabs)
 */
export type AuthStatus =
  'loading' | 'signedOut' | 'unverified' | 'needsProfile' | 'onboarding' | 'ready';

type AuthResult = { error: AuthError | null };

type ProfileResolution =
  | { kind: 'have'; profile: Profile }
  | { kind: 'absent' } // authenticated, verified, but no profile row → needsProfile
  | { kind: 'error' }; // transient (e.g. network) — retry, stay in loading

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  resendVerification: (email: string) => Promise<AuthResult>;
  sendPasswordReset: (email: string, redirectTo?: string) => Promise<AuthResult>;
  /** Force a re-fetch of the profile (e.g. after creating one in resume mode). */
  reload: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Fetch the caller's profile, auto-creating it from signup metadata when possible. */
async function resolveProfile(user: User): Promise<ProfileResolution> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return { kind: 'error' };
  if (data) return { kind: 'have', profile: data as Profile };

  // No profile yet. If the identity we captured at signup is on the auth user, create the
  // row now — this covers "verified but closed the app before the profile was written".
  const md = user.user_metadata as Partial<SignupIdentityMetadata> | undefined;
  if (md?.handle && md.display_name && md.date_of_birth) {
    const isPrivate = ageBandFromDob(new Date(md.date_of_birth)) === 'minor';
    const { data: created, error: insertError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        handle: md.handle,
        display_name: md.display_name,
        date_of_birth: md.date_of_birth,
        is_private: isPrivate,
        // Terms accepted at signup (carried in metadata) — persist so no re-prompt.
        terms_version: md.terms_version ?? null,
        terms_accepted_at: md.terms_accepted_at ?? null,
      })
      .select('*')
      .single();

    if (!insertError && created) return { kind: 'have', profile: created as Profile };
    // Insert failed (most likely the handle was taken since signup) → fall through and let
    // the identity screen resume so the user can pick a new handle.
  }

  return { kind: 'absent' };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  // The user id we have a DEFINITIVE profile answer for (found or confirmed-absent). While
  // this doesn't match the current user, profile resolution is still pending — status must
  // report 'loading', never a terminal state. Without this, the frame between "session
  // resolved" and "profile fetch started" briefly looks like (verified, profile=null) and
  // mis-computes 'needsProfile', which makes the auth guard bounce deep links to signup and
  // then to the tabs index — losing the originally requested route.
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const userId = session?.user?.id ?? null;
  const emailVerified = !!session?.user?.email_confirmed_at;

  // Session bootstrap + live updates.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Resolve (or create) the profile whenever we have a verified user.
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    if (!userId || !emailVerified || !session) {
      // Reset profile when the signed-in user goes away; status is signedOut/unverified here
      // regardless, so this only clears stale data — not a derived-state loop.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfile(null);
      return;
    }

    let active = true;
    (async () => {
      const result = await resolveProfile(session.user);
      if (!active) return;
      if (result.kind === 'error') {
        // Stay in loading and retry shortly rather than mis-routing to signup.
        retryTimer.current = setTimeout(() => setReloadNonce((n) => n + 1), 2500);
        return;
      }
      setProfile(result.kind === 'have' ? result.profile : null);
      // Mark this user's profile as definitively resolved (found or absent).
      setResolvedUserId(session.user.id);
    })();

    return () => {
      active = false;
    };
  }, [userId, emailVerified, session, reloadNonce]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    // Drop this device's push token first (needs the session to satisfy RLS).
    await unregisterPushToken().catch(() => {});
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const resendVerification = useCallback(async (email: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
    return { error };
  }, []);

  const sendPasswordReset = useCallback(
    async (email: string, redirectTo?: string): Promise<AuthResult> => {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        redirectTo ? { redirectTo } : undefined,
      );
      return { error };
    },
    [],
  );

  // Verified session but this user's profile isn't resolved yet → still loading, not a
  // terminal state. Covers the initial gap, the in-flight fetch, and user switches.
  const profilePending = !!userId && emailVerified && resolvedUserId !== userId;

  const status: AuthStatus = sessionLoading
    ? 'loading'
    : !session
      ? 'signedOut'
      : !emailVerified
        ? 'unverified'
        : profilePending
          ? 'loading'
          : !profile
            ? 'needsProfile'
            : profile.onboarding_complete
              ? 'ready'
              : 'onboarding';

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      profile,
      signIn,
      signOut,
      resendVerification,
      sendPasswordReset,
      reload,
    }),
    [status, session, profile, signIn, signOut, resendVerification, sendPasswordReset, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

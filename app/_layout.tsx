import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
// Importing GestureHandlerRootView here (the root layout expo-router loads first) also
// registers react-native-gesture-handler's native side effects before any app code runs.
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CameraCoachMark } from '@/components/camera-coach-mark';
import { OfflineBanner } from '@/components/offline-banner';
import { ReportIssueProvider } from '@/components/report-issue';
import { UploadBanner } from '@/components/upload-banner';
import { TERMS_VERSION } from '@/constants/legal';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { analytics, track } from '@/lib/analytics';
import { loadMutePreference } from '@/lib/mute-preference';
import { awardActiveDay } from '@/lib/points';
import { AuthProvider, useAuth, type AuthStatus } from '@/lib/auth-context';
import { NotificationsProvider } from '@/lib/notifications-provider';
import { initSentry, Sentry } from '@/lib/sentry';
import { UploadManagerProvider } from '@/lib/upload-manager';

// Initialise crash reporting as early as possible — before any component renders — so a
// crash during startup is still captured. No-ops when no DSN is configured.
initSentry();

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

/**
 * Redirect based on auth status:
 *   signedOut    → (auth)/login  (but signup screens under (auth) are left alone)
 *   needsProfile → signup/identity  (resume an abandoned signup)
 *   onboarding   → (onboarding)/tags
 *   ready        → (tabs)
 */
function useAuthGuard(status: AuthStatus) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;

    const parts = segments as string[];
    const inAuth = parts[0] === '(auth)';
    const inSignup = inAuth && parts[1] === 'signup';
    const inOnboarding = parts[0] === '(onboarding)';
    const signupStep = parts[2];

    if (status === 'signedOut') {
      if (!inAuth) router.replace('/(auth)/login');
    } else if (status === 'needsProfile') {
      if (!(inSignup && signupStep === 'identity')) router.replace('/(auth)/signup/identity');
    } else if (status === 'onboarding') {
      if (!inOnboarding) router.replace('/(onboarding)/tags');
    } else if (status === 'ready') {
      if (inAuth || inOnboarding) router.replace('/(tabs)');
    }
  }, [status, segments, router]);
}

function RootNavigator() {
  const { status, user, profile } = useAuth();
  const router = useRouter();
  useAuthGuard(status);
  const tutorialShown = useRef(false);
  const termsShown = useRef(false);
  const activeDayFired = useRef(false);

  // Award the once-per-day "active day" bonus the first time we reach a ready session
  // this launch. Server-capped to 1/day, so this is safe/idempotent.
  useEffect(() => {
    if (status === 'ready' && !activeDayFired.current) {
      activeDayFired.current = true;
      awardActiveDay();
    }
  }, [status]);

  // Terms re-acceptance gate (takes priority over the tutorial): if the accepted terms
  // version is behind the current one, require re-acceptance once. New signups accept the
  // current version at signup, so they are not prompted.
  useEffect(() => {
    if (status === 'ready' && profile && profile.terms_version !== TERMS_VERSION && !termsShown.current) {
      termsShown.current = true;
      router.push('/legal/accept');
      return;
    }
    // First-run tutorial: once onboarded (and terms are current), show it exactly once.
    if (
      status === 'ready' &&
      profile &&
      profile.terms_version === TERMS_VERSION &&
      !profile.tutorial_complete &&
      !tutorialShown.current
    ) {
      tutorialShown.current = true;
      router.push('/tutorial');
    }
  }, [status, profile, router]);

  useEffect(() => {
    // Keep the splash up until we know where to send the user, so protected screens
    // never flash before the guard redirects.
    if (status !== 'loading') SplashScreen.hideAsync();
  }, [status]);

  // Start analytics once (honours the opt-out before any event fires) and emit a
  // session_start. init() no-ops when opted out or no key is set. Also load the persisted
  // video mute preference so the first video card honours it.
  useEffect(() => {
    void analytics.init().then((on) => {
      if (on) track('session_start');
    });
    void loadMutePreference();
  }, []);

  // Identify by user id ONLY once signed in; also set the Sentry user to just the id.
  // Reset both on sign-out so identities never bleed across accounts.
  useEffect(() => {
    if (user?.id) {
      analytics.identify(user.id);
      Sentry.setUser({ id: user.id });
    } else if (status === 'signedOut') {
      analytics.reset();
      Sentry.setUser(null);
    }
  }, [user?.id, status]);

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(onboarding)" />
      {/* A regular pushed screen, NOT a modal: screens opened from Search (a
          profile, the seeded deck, a tag page) set their own headers, and
          changing a header's visibility on a screen presented within a modal
          remounts it — which caused an infinite reload loop when opening a
          profile from search. A card push avoids that entirely. */}
      <Stack.Screen name="search" options={{ headerShown: true, title: 'Search' }} />
      <Stack.Screen
        name="compose"
        options={{ presentation: 'modal', headerShown: true, title: 'New post' }}
      />
      <Stack.Screen
        name="post/[id]/edit"
        options={{ presentation: 'modal', headerShown: true, title: 'Edit post' }}
      />
      <Stack.Screen
        name="tutorial"
        options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="edit"
        options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen name="points" options={{ headerShown: true, title: 'How points work' }} />
      <Stack.Screen name="legal/[doc]" options={{ headerShown: true }} />
      <Stack.Screen
        name="legal/accept"
        options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen name="appeal" options={{ presentation: 'modal', headerShown: true, title: 'Appeal' }} />
      <Stack.Screen name="settings/sessions" options={{ headerShown: true, title: 'Devices & sessions' }} />
      <Stack.Screen name="recover" options={{ headerShown: true, title: 'Account recovery' }} />
    </Stack>
  );
}

function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AuthProvider>
            <NotificationsProvider>
              <UploadManagerProvider>
                {/* Wraps the app so a report can screenshot the screen behind it. */}
                <ReportIssueProvider>
                  <RootNavigator />
                  <UploadBanner />
                  <CameraCoachMark />
                  <OfflineBanner />
                </ReportIssueProvider>
              </UploadManagerProvider>
            </NotificationsProvider>
          </AuthProvider>
          <StatusBar style="auto" />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap adds an error boundary + touch/navigation breadcrumbs (all scrubbed by
// beforeBreadcrumb) around the whole app.
export default Sentry.wrap(RootLayout);

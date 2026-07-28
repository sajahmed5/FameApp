import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
// Importing GestureHandlerRootView here (the root layout expo-router loads first) also
// registers react-native-gesture-handler's native side effects before any app code runs.
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { UploadBanner } from '@/components/upload-banner';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth, type AuthStatus } from '@/lib/auth-context';
import { NotificationsProvider } from '@/lib/notifications-provider';
import { UploadManagerProvider } from '@/lib/upload-manager';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

/**
 * Redirect based on auth status:
 *   signedOut    → (auth)/login  (but signup screens under (auth) are left alone)
 *   unverified   → signup/verify
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
    } else if (status === 'unverified') {
      if (!(inSignup && signupStep === 'verify')) router.replace('/(auth)/signup/verify');
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
  const { status } = useAuth();
  useAuthGuard(status);

  useEffect(() => {
    // Keep the splash up until we know where to send the user, so protected screens
    // never flash before the guard redirects.
    if (status !== 'loading') SplashScreen.hideAsync();
  }, [status]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
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
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AuthProvider>
            <NotificationsProvider>
              <UploadManagerProvider>
                <RootNavigator />
                <UploadBanner />
              </UploadManagerProvider>
            </NotificationsProvider>
          </AuthProvider>
          <StatusBar style="auto" />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

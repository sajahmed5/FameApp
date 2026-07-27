import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
// Importing GestureHandlerRootView here (the root layout expo-router loads first) also
// registers react-native-gesture-handler's native side effects before any app code runs.
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  // Land on the tab group by default.
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    // Nothing async to wait on yet in the scaffold; hide the splash once mounted.
    SplashScreen.hideAsync();
  }, []);

  // TODO(auth): once Supabase auth is wired up, read the session here and branch —
  // send unauthenticated users into the `(auth)` group and authenticated users into
  // `(tabs)`. For the scaffold we always render the tab shell.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen
            name="search"
            options={{ presentation: 'modal', headerShown: true, title: 'Search' }}
          />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

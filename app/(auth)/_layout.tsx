import { Stack } from 'expo-router';

/**
 * Auth route group — kept separate from `(tabs)`. The root layout will branch into this
 * group for unauthenticated users once session handling lands. Screens: signup, login,
 * email verification.
 */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: true }} />;
}

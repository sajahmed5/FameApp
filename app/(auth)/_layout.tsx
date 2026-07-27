import { Stack } from 'expo-router';

/**
 * Auth route group — separate from `(tabs)`. The root layout routes unauthenticated
 * users here. Screens render their own headers/back affordances, so the stack header is
 * hidden.
 */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

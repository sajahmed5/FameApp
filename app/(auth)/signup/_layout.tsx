import { Stack } from 'expo-router';

import { SignupProvider } from '@/lib/signup-context';

/** The three-step signup flow shares an in-memory draft via SignupProvider. */
export default function SignupLayout() {
  return (
    <SignupProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SignupProvider>
  );
}

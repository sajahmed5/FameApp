import { Stack } from 'expo-router';

import { ScreenPlaceholder } from '@/components/screen-placeholder';

export default function SignupScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Sign up' }} />
      <ScreenPlaceholder title="Sign up" subtitle="Placeholder — auth wired up later." />
    </>
  );
}

import { Stack } from 'expo-router';

import { ScreenPlaceholder } from '@/components/screen-placeholder';

export default function LoginScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Log in' }} />
      <ScreenPlaceholder title="Log in" subtitle="Placeholder — auth wired up later." />
    </>
  );
}

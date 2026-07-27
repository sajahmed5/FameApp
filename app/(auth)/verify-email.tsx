import { Stack } from 'expo-router';

import { ScreenPlaceholder } from '@/components/screen-placeholder';

export default function VerifyEmailScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Verify email' }} />
      <ScreenPlaceholder
        title="Verify your email"
        subtitle="Placeholder — email verification wired up later."
      />
    </>
  );
}

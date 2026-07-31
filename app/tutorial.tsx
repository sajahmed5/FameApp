import { Stack, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { FirstRunTutorial } from '@/components/first-run-tutorial';
import { ReportFab } from '@/components/report-issue';
import { useAuth } from '@/lib/auth-context';
import { armCameraCoach } from '@/lib/coach-marks';
import { markTutorialComplete } from '@/lib/profile';

/**
 * First-run tutorial, presented as a full-screen modal. Auto-shown once after
 * onboarding (see app/(tabs)/_layout.tsx) and replayable from Settings.
 *
 * On finish/skip: persist completion to the profile (so it never auto-repeats), arm the
 * camera coach mark, then dismiss. Completion is best-effort — a failed write must not
 * trap the user in the tutorial.
 */
export default function TutorialModal() {
  const router = useRouter();
  const { reload } = useAuth();

  const done = useCallback(() => {
    void markTutorialComplete()
      .then(() => reload())
      .catch(() => {});
    void armCameraCoach();
    router.back();
  }, [router, reload]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <FirstRunTutorial onDone={done} />
      {/* fullScreenModal with gestureEnabled:false — a blocking first-run gate. Without
          its own button there is no way to report being stuck here. */}
      <ReportFab />
    </>
  );
}

/**
 * Thin haptics wrapper. Deliberately sparing — light impact only on meaningful commits
 * (a swipe that consumes a card, a double-tap like, an undo, a pull-to-refresh trigger),
 * never on ordinary taps. All calls are fire-and-forget and safe to no-op on web / when
 * the platform has no haptic engine.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

function run(fn: () => Promise<void>) {
  if (Platform.OS === 'web') return;
  void fn().catch(() => {});
}

export const haptics = {
  /** A committed swipe (like/skip), a double-tap like, or an undo. */
  light() {
    run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  },
  /** Pull-to-refresh crossing the trigger threshold. */
  refresh() {
    run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft));
  },
  /** A successful, consequential action (e.g. post published). Use sparingly. */
  success() {
    run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },
};

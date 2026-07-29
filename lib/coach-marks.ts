/**
 * One-shot coaching hints. Currently just the camera-tab coach mark shown after the
 * first-run tutorial, pointing the user at where to make their first post. State is
 * device-local (AsyncStorage) — a hint, not account data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const CAMERA_KEY = 'fame.coach.camera';

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => l());
}

/** Subscribe to camera-coach state changes (arm/dismiss). Returns an unsubscribe fn. */
export function onCameraCoachChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Arm the camera coach mark (call when the tutorial finishes). */
export async function armCameraCoach(): Promise<void> {
  await AsyncStorage.setItem(CAMERA_KEY, 'armed');
  notify();
}

/** Permanently dismiss it (on tap, or once the first post is made). */
export async function dismissCameraCoach(): Promise<void> {
  await AsyncStorage.setItem(CAMERA_KEY, 'done');
  notify();
}

/** True only while armed and not yet dismissed. */
export async function isCameraCoachArmed(): Promise<boolean> {
  return (await AsyncStorage.getItem(CAMERA_KEY)) === 'armed';
}

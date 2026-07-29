/**
 * Global video mute preference, persisted across cards AND sessions. Videos default to
 * muted; once the user unmutes, that choice carries to the next card and survives an app
 * restart. A tiny subscribable store (not context) so any video card reads/writes the same
 * value without prop-drilling.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'fame.video.muted';

let muted = true; // default: muted until the user opts in
let loaded = false;
const listeners = new Set<(m: boolean) => void>();

/** Load the persisted value once (call at startup). */
export async function loadMutePreference(): Promise<void> {
  if (loaded) return;
  const v = await AsyncStorage.getItem(KEY).catch(() => null);
  loaded = true;
  if (v === '0') {
    muted = false;
    listeners.forEach((l) => l(false));
  }
}

export function getMuted(): boolean {
  return muted;
}

export function setMutedPreference(next: boolean): void {
  muted = next;
  listeners.forEach((l) => l(next));
  void AsyncStorage.setItem(KEY, next ? '1' : '0').catch(() => {});
}

export function subscribeMute(fn: (m: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

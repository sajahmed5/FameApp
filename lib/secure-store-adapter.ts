import * as SecureStore from 'expo-secure-store';

/**
 * Supabase auth storage backed by expo-secure-store (Keychain / Keystore) instead of
 * AsyncStorage, so the session — an access + refresh token pair — is held in the OS
 * secure enclave rather than plaintext app storage.
 *
 * SecureStore rejects values larger than 2048 bytes, and a Supabase session can exceed
 * that (it carries user metadata). So values are transparently split into chunks: the
 * primary key stores either the value itself (when small) or a `__chunks__:N` marker,
 * and the N parts live under `${key}.0 … ${key}.N-1`. Keys only ever contain characters
 * SecureStore allows (alphanumerics, `.`, `-`, `_`).
 *
 * This adapter is native-only. On web, lib/supabase.ts leaves `storage` undefined so
 * supabase-js uses localStorage — SecureStore has no web implementation.
 */
const CHUNK_PREFIX = '__chunks__:';
// Conservative: session tokens are ASCII, so char count ≈ byte count, kept under 2048.
const CHUNK_SIZE = 1800;

async function getItem(key: string): Promise<string | null> {
  const head = await SecureStore.getItemAsync(key);
  if (head === null) return null;
  if (!head.startsWith(CHUNK_PREFIX)) return head;

  const count = Number.parseInt(head.slice(CHUNK_PREFIX.length), 10);
  if (!Number.isFinite(count) || count < 1) return null;

  let value = '';
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(`${key}.${i}`);
    if (part === null) return null; // partially written / corrupted — treat as absent
    value += part;
  }
  return value;
}

async function removeItem(key: string): Promise<void> {
  const head = await SecureStore.getItemAsync(key);
  if (head !== null && head.startsWith(CHUNK_PREFIX)) {
    const count = Number.parseInt(head.slice(CHUNK_PREFIX.length), 10);
    if (Number.isFinite(count)) {
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${key}.${i}`);
      }
    }
  }
  await SecureStore.deleteItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  // Clear any previous representation (chunked or not) before writing the new one.
  await removeItem(key);

  if (value.length <= CHUNK_SIZE) {
    await SecureStore.setItemAsync(key, value);
    return;
  }

  const count = Math.ceil(value.length / CHUNK_SIZE);
  for (let i = 0; i < count; i++) {
    await SecureStore.setItemAsync(
      `${key}.${i}`,
      value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
    );
  }
  await SecureStore.setItemAsync(key, `${CHUNK_PREFIX}${count}`);
}

/** Storage object matching the interface supabase-js expects for `auth.storage`. */
export const secureStoreAdapter = {
  getItem,
  setItem,
  removeItem,
};

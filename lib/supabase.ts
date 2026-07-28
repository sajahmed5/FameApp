import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

import { secureStoreAdapter } from '@/lib/secure-store-adapter';
import type { AppExtra } from '@/types';

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;
const { supabaseUrl, supabaseAnonKey } = extra;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_ANON_KEY in your .env ' +
      'file (see .env.example) — they are read in app.config.ts and exposed via ' +
      'Constants.expoConfig.extra.',
  );
}

/**
 * Shared Supabase client.
 *
 * Native sessions persist in the OS secure store (Keychain / Keystore) via
 * `secureStoreAdapter` — never AsyncStorage. On web there is no SecureStore, so we leave
 * `storage` undefined and supabase-js falls back to localStorage. `detectSessionInUrl`
 * only matters on web (magic-link / reset redirects land back in the browser).
 */
/** Exposed for direct calls to Edge Functions (e.g. the media upload pipeline via XHR). */
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

/**
 * Refresh the access token only while the app is foregrounded. supabase-js recommends
 * pausing the refresh timer in the background to avoid unnecessary work and races.
 * Native only — on web the tab lifecycle handles this.
 */
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

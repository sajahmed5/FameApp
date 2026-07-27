import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

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
 * On native, sessions persist through AsyncStorage. On web, supabase-js defaults to
 * `localStorage`, so we leave `storage` undefined there. `detectSessionInUrl` is only
 * relevant on web (OAuth / magic-link redirects).
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

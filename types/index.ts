/**
 * Shared application types.
 *
 * The generated Supabase schema types (`supabase gen types typescript ...`) will live
 * alongside this file later. For now we hand-declare the few shapes the app needs.
 */

/** Values passed from `app.config.ts` into the runtime via `expo-constants`. */
export type AppExtra = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** Sentry DSN (a publishable client key). Empty → crash reporting disabled. */
  sentryDsn?: string;
  /** PostHog project API key (publishable). Empty → analytics disabled/no-op. */
  posthogKey?: string;
  /** PostHog ingestion host, e.g. https://eu.i.posthog.com. */
  posthogHost?: string;
};

/** Coarse age band derived server-side from date of birth. */
export type AgeBand = 'minor' | 'adult';

/** A row of `public.profiles`. */
export type Profile = {
  id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  date_of_birth: string; // ISO `YYYY-MM-DD`
  is_private: boolean;
  age_band: AgeBand;
  points_balance: number;
  points_lifetime: number;
  search_radius_miles: number;
  onboarding_complete: boolean;
  /** First-run tutorial finished (or skipped) — stops it ever showing again. */
  tutorial_complete: boolean;
  /** Version of the Terms/Privacy the user last accepted (drives the re-accept gate). */
  terms_version: string | null;
  terms_accepted_at: string | null;
  /** Moderation state (client-read only; written by admins). */
  account_status: 'active' | 'suspended' | 'banned' | 'frozen';
  status_reason: string | null;
  created_at: string;
  updated_at: string;
};

/** A tag row from `public.tags`. */
export type Tag = {
  id: string;
  name: string;
  usage_count: number;
};

/** A row returned by the `get_suggested_accounts` RPC. */
export type SuggestedAccount = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_private: boolean;
  follower_count: number;
  overlap: number;
  follow_status: 'pending' | 'accepted' | null;
};

/** Identity fields captured during signup and stashed in auth user_metadata. */
export type SignupIdentityMetadata = {
  display_name: string;
  handle: string;
  date_of_birth: string; // ISO `YYYY-MM-DD`
  terms_version: string;
  terms_accepted_at: string; // ISO timestamp
};

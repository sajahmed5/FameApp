/**
 * Shared application types.
 *
 * The generated Supabase schema types (`supabase gen types typescript ...`) will live
 * alongside this file later. For the scaffold we only declare the shape of the values
 * we inject through `app.config.ts` -> `Constants.expoConfig.extra`.
 */

/** Values passed from `app.config.ts` into the runtime via `expo-constants`. */
export type AppExtra = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

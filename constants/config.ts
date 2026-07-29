/**
 * App-wide static configuration and design tokens that aren't part of the light/dark
 * color system in `theme.ts`.
 */
export const APP_NAME = 'Fame';

/** Support / contact address, used by Settings and the account-recovery flow. */
export const SUPPORT_EMAIL = 'support@lovefame.co.uk';

/** Brand accent — matches the splash screen background. */
export const BRAND = {
  accent: '#208AEF',
  onAccent: '#FFFFFF',
} as const;

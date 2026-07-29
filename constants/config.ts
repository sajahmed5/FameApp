/**
 * App-wide static configuration and design tokens that aren't part of the light/dark
 * color system in `theme.ts`.
 */
export const APP_NAME = 'Fame';

/** Support / contact address, used by Settings and the account-recovery flow. */
export const SUPPORT_EMAIL = 'support@lovefame.co.uk';

/** Brand accent — burnt orange, matches the Fame logo. */
export const BRAND = {
  accent: '#C85A28',
  onAccent: '#FFFFFF',
} as const;

/** Floating (Instagram-style) bottom tab bar geometry. */
export const TAB_BAR = { height: 60, side: 14, bottom: 12 } as const;
/**
 * Space the floating tab bar occupies *above* the screen's bottom safe-area inset.
 * Add `insets.bottom + TAB_BAR_CLEARANCE` to a scroll view's paddingBottom (or an
 * over-media overlay) so its content isn't hidden behind the floating bar.
 */
export const TAB_BAR_CLEARANCE = TAB_BAR.height + TAB_BAR.bottom + 16;

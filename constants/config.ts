/**
 * App-wide static configuration and design tokens that aren't part of the light/dark
 * color system in `theme.ts`.
 */
export const APP_NAME = 'Phixr';

/** Support / contact address, used by Settings and the account-recovery flow. */
export const SUPPORT_EMAIL = 'support@joinphixr.com';

/** Brand accent — phixr core orange (#FF7A18), from the logo gradient. */
export const BRAND = {
  accent: '#FF7A18',
  onAccent: '#FFFFFF',
} as const;

/**
 * Story avatar-ring colours. A bright ring (theme.tint) means there's something
 * you haven't seen — your own freshly-posted story, or an unviewed story from
 * someone you follow. Once you've watched it, the ring dims to this dark burnt
 * orange (still clearly "has a story", just no longer new).
 */
export const STORY_RING_SEEN = '#8A4A28';

/** Floating (Instagram-style) bottom tab bar geometry. */
export const TAB_BAR = { height: 60, side: 14, bottom: 12 } as const;
/**
 * Space the floating tab bar occupies *above* the screen's bottom safe-area inset.
 * Add `insets.bottom + TAB_BAR_CLEARANCE` to a scroll view's paddingBottom (or an
 * over-media overlay) so its content isn't hidden behind the floating bar.
 */
export const TAB_BAR_CLEARANCE = TAB_BAR.height + TAB_BAR.bottom + 16;

import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * While `active`, intercept the Android hardware back button and run `onBack` (e.g. dismiss
 * an overlay) instead of letting it pop the underlying route. No-op on iOS. Overlays
 * rendered as in-screen Views (share sheet, comment sheet, action menu) need this because,
 * unlike RN Modals, they don't otherwise consume back.
 */
export function useAndroidBack(active: boolean, onBack: () => void) {
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true; // handled — don't pop the route
    });
    return () => sub.remove();
  }, [active, onBack]);
}

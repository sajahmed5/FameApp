import { useCallback, useState } from 'react';

import { haptics } from '@/lib/haptics';

/**
 * Standardised pull-to-refresh: fires the refresh haptic on trigger and tracks the
 * spinner state. Pair with `<RefreshControl {...refresh} />`.
 */
export function useRefresh(load: () => Promise<unknown> | unknown) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    haptics.refresh();
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);
  return { refreshing, onRefresh };
}

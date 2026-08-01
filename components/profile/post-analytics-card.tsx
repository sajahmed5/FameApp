import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { getPostAnalytics, type PostAnalytics } from '@/lib/profile';

/** Per-post analytics (own posts only). Aggregate counts + like/skip rate; rates are
 *  suppressed by the RPC on tiny samples, so no individual swiper can be inferred. */
export function PostAnalyticsCard({ postId }: { postId: string }) {
  const theme = useTheme();
  const [data, setData] = useState<PostAnalytics | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setData(await getPostAnalytics(postId));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [postId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-loader; sets loading/error state internally
    void load();
  }, [load]);

  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <View style={styles.titleRow}>
        <ThemedText type="smallBold">Analytics</ThemedText>
        {status === 'ready' && data && !data.sample_suppressed ? (
          <ThemedText type="small" themeColor="textSecondary">
            {Math.round((data.like_rate ?? 0) * 100)}% liked · {Math.round((data.skip_rate ?? 0) * 100)}% skipped
          </ThemedText>
        ) : null}
      </View>
      {status === 'loading' ? (
        <ActivityIndicator color={theme.textSecondary} style={styles.pad} />
      ) : status === 'error' || !data ? (
        <ThemedText type="small" themeColor="textSecondary">
          Couldn&apos;t load analytics.
        </ThemedText>
      ) : (
        <>
          <View style={styles.row}>
            <Metric label="Reach" value={data.reach} />
            <Metric label="Likes" value={data.likes} />
            <Metric label="Skips" value={data.skips} />
            <Metric label="Comments" value={data.comments} />
            <Metric label="Shares" value={data.shares} />
          </View>
          {data.sample_suppressed ? (
            <ThemedText type="small" themeColor="textSecondary">
              Rates appear after a few more swipes.
            </ThemedText>
          ) : null}
        </>
      )}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <ThemedText type="subtitle">{Number(value).toLocaleString()}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  // Compact (#27): one tight strip, not a panel — it sits between caption and comments.
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  pad: { paddingVertical: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  metric: { alignItems: 'center', gap: 2, flex: 1 },
});

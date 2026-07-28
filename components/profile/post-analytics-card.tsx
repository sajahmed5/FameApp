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
  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-loader; sets loading/error state internally
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">Post analytics</ThemedText>
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
              Like/skip rates appear once this post has a few more swipes.
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {Math.round((data.like_rate ?? 0) * 100)}% liked ·{' '}
              {Math.round((data.skip_rate ?? 0) * 100)}% skipped
            </ThemedText>
          )}
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
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, gap: 10 },
  pad: { paddingVertical: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  metric: { alignItems: 'center', gap: 2, flex: 1 },
});

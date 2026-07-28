import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import {
  getAccountAnalytics,
  getTagReach,
  type AccountAnalytics,
  type TagReach,
} from '@/lib/profile';

export default function AnalyticsScreen() {
  const theme = useTheme();
  const [account, setAccount] = useState<AccountAnalytics | null>(null);
  const [tags, setTags] = useState<TagReach[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [a, t] = await Promise.all([getAccountAnalytics(), getTagReach()]);
      setAccount(a);
      setTags(t);
    } catch {
      setError(true);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-loader; sets loading/error state internally
  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <ThemedView style={styles.center}>
        <Stack.Screen options={{ headerShown: true, title: 'Analytics' }} />
        <ThemedText type="small" themeColor="textSecondary">
          Couldn&apos;t load analytics.
        </ThemedText>
        <Button title="Retry" variant="secondary" onPress={load} />
      </ThemedView>
    );
  }
  if (!account || !tags) {
    return (
      <ThemedView style={styles.center}>
        <Stack.Screen options={{ headerShown: true, title: 'Analytics' }} />
        <ActivityIndicator color={theme.textSecondary} />
      </ThemedView>
    );
  }

  const maxReach = Math.max(1, ...tags.map((t) => Number(t.reach)));
  const maxWeek = Math.max(1, ...account.follower_growth.map((w) => w.new_followers));

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: 'Analytics' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Top-line numbers */}
        <View style={styles.statRow}>
          <BigStat label="Followers" value={account.follower_count} />
          <BigStat label="Posts" value={account.post_count} />
          <BigStat label="Total reach" value={account.total_reach} />
        </View>

        {/* TAG REACH — the most useful screen: which tags actually pull reach */}
        <Section
          title="Which tags pull reach"
          subtitle="Your tags ranked by the reach they've earned. Small samples are hidden.">
          {tags.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Not enough data yet — once your tagged posts get some swipes, the tags that pull reach
              show up here.
            </ThemedText>
          ) : (
            <View style={styles.bars}>
              {tags.map((t) => (
                <View key={t.tag} style={styles.barRow}>
                  <ThemedText type="small" style={styles.barLabel} numberOfLines={1}>
                    #{t.tag}
                  </ThemedText>
                  <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${(Number(t.reach) / maxReach) * 100}%`,
                          backgroundColor: BRAND.accent,
                        },
                      ]}
                    />
                  </View>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.barValue}>
                    {t.reach}
                    {t.like_rate != null ? ` · ${Math.round(t.like_rate * 100)}% liked` : ''}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </Section>

        {/* Follower growth (aggregate weekly counts — never who) */}
        <Section title="Follower growth" subtitle="New followers per week.">
          {account.follower_growth.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No followers yet.
            </ThemedText>
          ) : (
            <View style={styles.weekRow}>
              {account.follower_growth.slice(-12).map((w) => (
                <View key={w.week} style={styles.weekCol}>
                  <View style={styles.weekBarWrap}>
                    <View
                      style={[
                        styles.weekBar,
                        {
                          height: `${(w.new_followers / maxWeek) * 100}%`,
                          backgroundColor: BRAND.accent,
                        },
                      ]}
                    />
                  </View>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.weekLabel}>
                    {new Date(w.week).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </Section>

        {/* Points → distribution, in plain English */}
        <Section title="Points & distribution">
          <View style={styles.pointsRow}>
            <BigStat label="Balance" value={account.points_balance} />
            <BigStat label="Lifetime" value={account.points_lifetime} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {pointsExplanation(account.points_balance, account.distribution_multiplier)}
          </ThemedText>
        </Section>
      </ScrollView>
    </ThemedView>
  );
}

function pointsExplanation(balance: number, multiplier: number): string {
  if (balance <= 0) {
    return (
      'Your points give your posts a small nudge in how far they travel. Earn points by posting, ' +
      'commenting and getting engagement — the more you earn, the wider your posts reach.'
    );
  }
  const level = multiplier > 5 ? 'a strong' : multiplier > 4 ? 'a solid' : 'a modest';
  return (
    `Your ${balance.toLocaleString()} points currently give your posts ${level} reach boost. ` +
    'Points are one signal among your tags and how fresh a post is — earning more widens your distribution over time.'
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">{title}</ThemedText>
      {subtitle ? (
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      ) : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function BigStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.bigStat}>
      <ThemedText type="title">{Number(value).toLocaleString()}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  content: { padding: 20, gap: 28 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  bigStat: { alignItems: 'center', gap: 2, flex: 1 },
  section: { gap: 6 },
  sectionBody: { marginTop: 8, gap: 10 },
  bars: { gap: 10 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 80 },
  barTrack: { flex: 1, height: 12, borderRadius: 6, overflow: 'hidden' },
  barFill: { height: 12, borderRadius: 6 },
  barValue: { width: 96, textAlign: 'right' },
  weekRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 120 },
  weekCol: { flex: 1, alignItems: 'center', gap: 4 },
  weekBarWrap: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  weekBar: { width: '100%', borderRadius: 4, minHeight: 3 },
  weekLabel: { fontSize: 9 },
  pointsRow: { flexDirection: 'row', gap: 20, marginBottom: 6 },
});

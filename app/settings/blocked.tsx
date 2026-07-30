import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { UserRow } from '@/components/profile/user-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { getBlockedAndMuted, unblockUser, unmuteUser, type BlockedMuted } from '@/lib/profile';

export default function BlockedScreen() {
  const theme = useTheme();
  const [data, setData] = useState<BlockedMuted | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(false);
    try {
      setData(await getBlockedAndMuted());
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-loader; sets loading/error state internally
    void load();
  }, [load]);

  async function act(id: string, kind: 'block' | 'mute') {
    setBusy((s) => new Set(s).add(id));
    try {
      if (kind === 'block') await unblockUser(id);
      else await unmuteUser(id);
      setData(
        (prev) =>
          prev && {
            blocked: kind === 'block' ? prev.blocked.filter((u) => u.id !== id) : prev.blocked,
            muted: kind === 'mute' ? prev.muted.filter((u) => u.id !== id) : prev.muted,
          },
      );
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: 'Blocked & muted' }} />
      {error ? (
        <View style={styles.center}>
          <ThemedText type="small" themeColor="textSecondary">
            Couldn&apos;t load this list.
          </ThemedText>
          <Button title="Retry" variant="secondary" onPress={load} />
        </View>
      ) : data === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Section title="Blocked">
            {data.blocked.length === 0 ? (
              <Empty text="You haven't blocked anyone." />
            ) : (
              data.blocked.map((u) => (
                <UserRow
                  key={u.id}
                  handle={u.handle}
                  displayName={u.display_name}
                  avatarUrl={u.avatar_url}
                  right={
                    <Button
                      title="Unblock"
                      variant="secondary"
                      onPress={() => act(u.id, 'block')}
                      loading={busy.has(u.id)}
                      style={styles.btn}
                    />
                  }
                />
              ))
            )}
          </Section>
          <Section title="Muted">
            {data.muted.length === 0 ? (
              <Empty text="You haven't muted anyone." />
            ) : (
              data.muted.map((u) => (
                <UserRow
                  key={u.id}
                  handle={u.handle}
                  displayName={u.display_name}
                  avatarUrl={u.avatar_url}
                  right={
                    <Button
                      title="Unmute"
                      variant="secondary"
                      onPress={() => act(u.id, 'mute')}
                      loading={busy.has(u.id)}
                      style={styles.btn}
                    />
                  }
                />
              ))
            )}
          </Section>
        </ScrollView>
      )}
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </ThemedText>
      {children}
    </View>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
      {text}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  content: { paddingVertical: 12, gap: 20 },
  section: { gap: 4 },
  sectionTitle: { paddingHorizontal: 16, letterSpacing: 0.5 },
  empty: { paddingHorizontal: 16, paddingVertical: 8 },
  btn: { height: 36, paddingHorizontal: 14 },
});

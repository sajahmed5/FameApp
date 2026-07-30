import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { UserRow } from '@/components/profile/user-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { acceptRequest, getFollowRequests, rejectRequest, type FollowRequest } from '@/lib/profile';

export default function RequestsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [rows, setRows] = useState<FollowRequest[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(false);
    try {
      setRows(await getFollowRequests());
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-loader; sets loading/error state internally
    void load();
  }, [load]);

  async function act(followerId: string, accept: boolean) {
    setBusy((s) => new Set(s).add(followerId));
    try {
      if (accept) await acceptRequest(followerId);
      else await rejectRequest(followerId);
      setRows((prev) => (prev ?? []).filter((r) => r.follower_id !== followerId));
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(followerId);
        return n;
      });
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Follow requests' }} />
      {error ? (
        <View style={styles.center}>
          <ThemedText type="small" themeColor="textSecondary">
            Couldn&apos;t load requests.
          </ThemedText>
          <Button title="Retry" variant="secondary" onPress={load} />
        </View>
      ) : rows === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <ThemedText type="small" themeColor="textSecondary">
            No pending requests.
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.follower_id}
          renderItem={({ item }) => (
            <UserRow
              handle={item.handle}
              displayName={item.display_name}
              avatarUrl={item.avatar_url}
              onPress={() => router.push(`/u/${item.handle}`)}
              right={
                <View style={styles.actions}>
                  <Button
                    title="Accept"
                    onPress={() => act(item.follower_id, true)}
                    loading={busy.has(item.follower_id)}
                    style={styles.accept}
                  />
                  <Button
                    title="Reject"
                    variant="secondary"
                    onPress={() => act(item.follower_id, false)}
                    disabled={busy.has(item.follower_id)}
                    style={styles.reject}
                  />
                </View>
              }
            />
          )}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  actions: { flexDirection: 'row', gap: 8 },
  accept: { height: 36, paddingHorizontal: 14, backgroundColor: BRAND.accent },
  reject: { height: 36, paddingHorizontal: 14 },
});

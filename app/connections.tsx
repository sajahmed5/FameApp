import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { UserRow } from '@/components/profile/user-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { getConnections, type Connection } from '@/lib/profile';
import { useRefresh } from '@/lib/use-refresh';

export default function ConnectionsScreen() {
  const { userId, type } = useLocalSearchParams<{
    userId: string;
    type: 'followers' | 'following';
  }>();
  const router = useRouter();
  const theme = useTheme();
  const [rows, setRows] = useState<Connection[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      setRows(await getConnections(userId, type));
    } catch {
      setError(true);
    }
  }, [userId, type]);

  const refresh = useRefresh(load);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-loader; sets loading/error state internally
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{ headerShown: true, title: type === 'followers' ? 'Followers' : 'Following' }}
      />
      {error ? (
        <View style={styles.center}>
          <ThemedText type="small" themeColor="textSecondary">
            Couldn&apos;t load the list.
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
            {type === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <UserRow
              handle={item.handle}
              displayName={item.display_name}
              avatarUrl={item.avatar_url}
              onPress={() => router.push(`/u/${item.handle}`)}
            />
          )}
          refreshControl={<RefreshControl {...refresh} tintColor={theme.textSecondary} />}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
});

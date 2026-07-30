import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { UserRow } from '@/components/profile/user-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { confirm } from '@/lib/confirm';
import { getConnections, removeFollower, type Connection } from '@/lib/profile';
import { useRefresh } from '@/lib/use-refresh';

export default function ConnectionsScreen() {
  const { userId, type } = useLocalSearchParams<{
    userId: string;
    type: 'followers' | 'following';
  }>();
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuth();
  const [rows, setRows] = useState<Connection[] | null>(null);
  const [error, setError] = useState(false);

  // You can only remove followers from your OWN followers list.
  const canRemove = type === 'followers' && userId === user?.id;

  const load = useCallback(async () => {
    setError(false);
    try {
      setRows(await getConnections(userId, type));
    } catch {
      setError(true);
    }
  }, [userId, type]);

  const refresh = useRefresh(load);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-loader; sets loading/error state internally
    void load();
  }, [load]);

  const remove = async (item: Connection) => {
    if (!(await confirm('Remove follower?', `@${item.handle} will stop following you. They can follow again later.`, 'Remove'))) return;
    setRows((prev) => prev?.filter((r) => r.id !== item.id) ?? prev); // optimistic
    try {
      await removeFollower(item.id);
    } catch {
      void load(); // restore on failure
    }
  };

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
              right={
                canRemove ? (
                  <Pressable
                    onPress={() => remove(item)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove @${item.handle}`}
                    style={[styles.removeBtn, { borderColor: theme.border }]}>
                    <ThemedText type="small" style={{ color: theme.text }}>Remove</ThemedText>
                  </Pressable>
                ) : undefined
              }
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
  removeBtn: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
});

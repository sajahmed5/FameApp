import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BRAND } from '@/constants/config';
import { confirm } from '@/lib/confirm';
import { getMySwipes, undoSwipe, type SwipedPost, type SwipeDirection } from '@/lib/deck';
import { useTheme } from '@/hooks/use-theme';

/**
 * Private review of what you've Liked / Skipped, so you can change your mind. Owner-only.
 * Undo puts a post back in play (it can resurface in your deck). Reached from your profile.
 */
export default function SwipesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const [dir, setDir] = useState<SwipeDirection>(tab === 'skipped' ? 'left' : 'right');
  const [items, setItems] = useState<SwipedPost[] | null>(null);

  const load = useCallback(async (d: SwipeDirection) => {
    setItems(null);
    try {
      setItems(await getMySwipes(d));
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when the tab changes
    void load(dir);
  }, [dir, load]);

  const remove = async (postId: string) => {
    const verb = dir === 'right' ? 'Unlike' : 'Un-skip';
    if (!(await confirm(`${verb} this post?`, 'It can appear in your deck again.', verb))) return;
    try {
      await undoSwipe(postId);
      setItems((prev) => prev?.filter((p) => p.post_id !== postId) ?? prev);
    } catch {
      /* ignore */
    }
  };

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: 'Your activity' }} />

      <View style={[styles.tabs, { borderBottomColor: theme.border }]}>
        <TabButton label="Liked" active={dir === 'right'} onPress={() => setDir('right')} />
        <TabButton label="Skipped" active={dir === 'left'} onPress={() => setDir('left')} />
      </View>

      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons
            name={dir === 'right' ? 'heart-outline' : 'close-circle-outline'}
            size={40}
            color={theme.textSecondary}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {dir === 'right' ? "You haven't liked anything yet." : "You haven't skipped anything yet."}
          </ThemedText>
        </View>
      ) : (
        <Grid items={items} onOpen={(id) => router.push(`/post/${id}`)} onUndo={remove} dir={dir} />
      )}
    </ThemedView>
  );
}

function Grid({
  items,
  onOpen,
  onUndo,
  dir,
}: {
  items: SwipedPost[];
  onOpen: (id: string) => void;
  onUndo: (id: string) => void;
  dir: SwipeDirection;
}) {
  const { width } = useWindowDimensions();
  const gap = 2;
  const size = (width - gap * 2) / 3;
  return (
    <FlatList
      data={items}
      keyExtractor={(p) => p.post_id}
      numColumns={3}
      columnWrapperStyle={{ gap }}
      contentContainerStyle={{ gap }}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => onOpen(item.post_id)}
          style={{ width: size, height: size }}
          accessibilityRole="button"
          accessibilityLabel="Open post">
          <Image source={{ uri: item.thumbnail_url }} style={styles.thumb} contentFit="cover" recyclingKey={item.post_id} />
          <Pressable
            onPress={() => onUndo(item.post_id)}
            hitSlop={6}
            style={styles.undo}
            accessibilityRole="button"
            accessibilityLabel={dir === 'right' ? 'Unlike' : 'Un-skip'}>
            <Ionicons name="arrow-undo" size={14} color="#fff" />
          </Pressable>
        </Pressable>
      )}
    />
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={styles.tab} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <ThemedText type="smallBold" style={{ color: active ? BRAND.accent : theme.textSecondary }}>
        {label}
      </ThemedText>
      <View style={[styles.tabBar, { backgroundColor: active ? BRAND.accent : 'transparent' }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingTop: 12, gap: 10 },
  tabBar: { height: 2, width: '60%', borderRadius: 1 },
  thumb: { width: '100%', height: '100%', backgroundColor: '#111' },
  undo: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    padding: 5,
  },
});

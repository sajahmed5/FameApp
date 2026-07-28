import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { formatRelative } from '@/lib/relative-time';
import {
  getConversations,
  leaveConversation,
  setMuted,
  subscribeToInbox,
  type Conversation,
} from '@/lib/messages';

export default function MessagesScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [items, setItems] = useState<Conversation[]>([]);
  const [tab, setTab] = useState<'messages' | 'requests'>('messages');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const openRow = useRef<Swipeable | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await getConversations());
    } catch {
      /* keep */
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload on focus + live-refresh when a message lands in any of my conversations.
  useFocusEffect(
    useCallback(() => {
      void load();
      const unsub = subscribeToInbox(() => void load());
      return unsub;
    }, [load]),
  );

  const requestCount = useMemo(() => items.filter((c) => c.is_request).length, [items]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((c) => (tab === 'requests' ? c.is_request : !c.is_request))
      .filter((c) => {
        if (!q) return true;
        const name = c.type === 'group' ? c.name ?? 'Group' : c.other_display_name ?? '';
        return (
          name.toLowerCase().includes(q) ||
          (c.other_handle ?? '').toLowerCase().includes(q) ||
          (c.last_body ?? '').toLowerCase().includes(q)
        );
      });
  }, [items, tab, query]);

  return (
    <ThemedView style={{ flex: 1 }}>
      <View style={styles.tabs}>
        {(['messages', 'requests'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && { borderBottomColor: theme.tint, borderBottomWidth: 2 }]}>
            <ThemedText type="smallBold" style={{ color: tab === t ? theme.text : theme.textSecondary }}>
              {t === 'messages' ? 'Messages' : `Requests${requestCount ? ` (${requestCount})` : ''}`}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <Ionicons name="search" size={16} color={theme.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search conversations"
          placeholderTextColor={theme.textSecondary}
          style={[styles.searchInput, { color: theme.text }]}
          autoCorrect={false}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(c) => c.id}
          contentContainerStyle={shown.length === 0 ? styles.center : undefined}
          renderItem={({ item }) => (
            <ConversationRow
              conversation={item}
              meId={user?.id}
              onOpen={() => router.push({ pathname: '/conversation/[id]', params: { id: item.id } })}
              onMute={async () => {
                await setMuted(item.id, !item.muted);
                void load();
              }}
              onLeave={async () => {
                await leaveConversation(item.id);
                void load();
              }}
              openRowRef={openRow}
            />
          )}
          ListEmptyComponent={
            <ThemedText type="default" themeColor="textSecondary" style={{ textAlign: 'center' }}>
              {tab === 'requests' ? 'No message requests.' : 'No conversations yet.'}
            </ThemedText>
          }
        />
      )}

      <Pressable
        onPress={() => router.push('/messages/new')}
        style={[styles.fab, { backgroundColor: theme.tint }]}
        accessibilityLabel="New message">
        <Ionicons name="create-outline" size={24} color="#fff" />
      </Pressable>
    </ThemedView>
  );
}

function ConversationRow({
  conversation: c,
  meId,
  onOpen,
  onMute,
  onLeave,
  openRowRef,
}: {
  conversation: Conversation;
  meId?: string;
  onOpen: () => void;
  onMute: () => void;
  onLeave: () => void;
  openRowRef: React.MutableRefObject<Swipeable | null>;
}) {
  const theme = useTheme();
  const rowRef = useRef<Swipeable | null>(null);
  const title = c.type === 'group' ? c.name ?? 'Group' : c.other_display_name ?? c.other_handle ?? 'Unknown';
  const avatar = c.type === 'group' ? c.avatar_url : c.other_avatar_url;
  const preview = c.last_shared ? '📷 Shared a post' : c.last_media ? '📷 Photo' : c.last_body ?? 'No messages yet';
  const mine = c.last_sender_id === meId;

  return (
    <Swipeable
      ref={(r) => {
        rowRef.current = r;
      }}
      onSwipeableWillOpen={() => {
        if (openRowRef.current && openRowRef.current !== rowRef.current) openRowRef.current.close();
        openRowRef.current = rowRef.current;
      }}
      renderRightActions={() => (
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              rowRef.current?.close();
              onMute();
            }}
            style={[styles.action, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name={c.muted ? 'notifications' : 'notifications-off'} size={18} color={theme.text} />
            <ThemedText type="small">{c.muted ? 'Unmute' : 'Mute'}</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => {
              rowRef.current?.close();
              onLeave();
            }}
            style={[styles.action, { backgroundColor: theme.danger }]}>
            <Ionicons name="exit-outline" size={18} color="#fff" />
            <ThemedText type="small" style={{ color: '#fff' }}>
              {c.type === 'group' ? 'Leave' : 'Delete'}
            </ThemedText>
          </Pressable>
        </View>
      )}>
      <Pressable onPress={onOpen} style={[styles.row, { backgroundColor: theme.background }]}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name={c.type === 'group' ? 'people' : 'person'} size={20} color={theme.textSecondary} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.rowTop}>
            <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>
              {title}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatRelative(c.last_at)}
            </ThemedText>
          </View>
          <View style={styles.rowBottom}>
            <ThemedText
              type="small"
              themeColor={c.unread ? 'text' : 'textSecondary'}
              numberOfLines={1}
              style={{ flex: 1, fontWeight: c.unread ? '700' : '400' }}>
              {mine ? 'You: ' : ''}
              {preview}
            </ThemedText>
            {c.muted ? <Ionicons name="notifications-off" size={13} color={theme.textSecondary} /> : null}
            {c.unread ? <View style={[styles.dot, { backgroundColor: theme.tint }]} /> : null}
          </View>
        </View>
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  tabs: { flexDirection: 'row', paddingHorizontal: 12 },
  tab: { paddingVertical: 10, paddingHorizontal: 12, marginRight: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginVertical: 8,
    paddingHorizontal: 10,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  actions: { flexDirection: 'row' },
  action: { width: 78, alignItems: 'center', justifyContent: 'center', gap: 3 },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 22,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
});

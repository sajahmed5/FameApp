import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { createGroup, startDirect } from '@/lib/messages';
import { searchAccounts, type AccountHit } from '@/lib/search';

export default function NewMessageScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AccountHit[]>([]);
  const [selected, setSelected] = useState<AccountHit[]>([]);
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const rid = useRef(0);

  useEffect(() => {
    const t = setTimeout(async () => {
      const q = query.trim();
      if (q.length < 1) {
        setResults([]);
        return;
      }
      const id = ++rid.current;
      setLoading(true);
      try {
        const r = await searchAccounts(q, 0, 20);
        if (id === rid.current) setResults(r);
      } catch {
        if (id === rid.current) setResults([]);
      } finally {
        if (id === rid.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const pickDirect = useCallback(async (a: AccountHit) => {
    if (busy) return;
    setBusy(true);
    try {
      const cid = await startDirect(a.id);
      router.replace({ pathname: '/conversation/[id]', params: { id: cid } });
    } catch (e) {
      setBusy(false);
      Alert.alert('Messages', e instanceof Error && e.message.includes('not_allowed') ? "You can't message this account." : 'Could not start the conversation.');
    }
  }, [busy]);

  const toggleSelect = useCallback((a: AccountHit) => {
    setSelected((prev) => (prev.some((s) => s.id === a.id) ? prev.filter((s) => s.id !== a.id) : [...prev, a]));
  }, []);

  const createTheGroup = useCallback(async () => {
    if (busy || selected.length === 0) return;
    setBusy(true);
    try {
      const cid = await createGroup(groupName.trim(), selected.map((s) => s.id));
      router.replace({ pathname: '/conversation/[id]', params: { id: cid } });
    } catch (e) {
      setBusy(false);
      Alert.alert('Messages', e instanceof Error && e.message.includes('not_allowed') ? 'Some members can’t be added (age or block restrictions).' : 'Could not create the group.');
    }
  }, [busy, selected, groupName]);

  return (
    <ThemedView style={{ flex: 1, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={theme.text} /></Pressable>
        <ThemedText type="subtitle" style={{ flex: 1 }}>{mode === 'group' ? 'New group' : 'New message'}</ThemedText>
        <Pressable onPress={() => setMode((m) => (m === 'direct' ? 'group' : 'direct'))} hitSlop={8}>
          <ThemedText type="small" style={{ color: theme.tint, fontWeight: '700' }}>{mode === 'direct' ? 'New group' : 'Direct'}</ThemedText>
        </Pressable>
      </View>

      {mode === 'group' ? (
        <TextInput
          value={groupName}
          onChangeText={setGroupName}
          placeholder="Group name (optional)"
          placeholderTextColor={theme.textSecondary}
          style={[styles.groupName, { color: theme.text, borderColor: theme.border }]}
        />
      ) : null}

      {mode === 'group' && selected.length > 0 ? (
        <View style={styles.chips}>
          {selected.map((s) => (
            <Pressable key={s.id} onPress={() => toggleSelect(s)} style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="small">@{s.handle}</ThemedText>
              <Ionicons name="close" size={13} color={theme.textSecondary} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <Ionicons name="search" size={16} color={theme.textSecondary} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search people" placeholderTextColor={theme.textSecondary} autoFocus autoCapitalize="none" style={[styles.searchInput, { color: theme.text }]} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ padding: 16 }} color={theme.textSecondary} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(a) => a.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isSel = selected.some((s) => s.id === item.id);
            return (
              <Pressable onPress={() => (mode === 'group' ? toggleSelect(item) : pickDirect(item))} style={styles.row}>
                {item.avatar_url ? (
                  <Image source={{ uri: item.avatar_url }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText type="smallBold">{(item.display_name || item.handle).slice(0, 1).toUpperCase()}</ThemedText>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>{item.display_name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">@{item.handle}</ThemedText>
                </View>
                {mode === 'group' ? <Ionicons name={isSel ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={isSel ? theme.tint : theme.textSecondary} /> : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={query.trim() ? <ThemedText type="small" themeColor="textSecondary" style={{ padding: 16, textAlign: 'center' }}>No people found.</ThemedText> : null}
        />
      )}

      {mode === 'group' ? (
        <Pressable onPress={createTheGroup} disabled={busy || selected.length === 0} style={[styles.createBtn, { backgroundColor: selected.length ? theme.tint : theme.backgroundElement, marginBottom: insets.bottom + 10 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <ThemedText type="smallBold" style={{ color: selected.length ? '#fff' : theme.textSecondary }}>Create group ({selected.length})</ThemedText>}
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  groupName: { marginHorizontal: 12, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 8, paddingHorizontal: 10, height: 40, borderRadius: 10, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  createBtn: { marginHorizontal: 12, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ReportFab } from '@/components/report-issue';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import {
  createCollection,
  getBookmarkState,
  getCollections,
  removeBookmark,
  saveBookmark,
  type Collection,
} from '@/lib/bookmarks';

/**
 * Bottom sheet for saving a post into a collection (or unsorted "All saved"),
 * moving it between collections, creating a new one, or removing the bookmark.
 * `onChange` reports the resulting saved state so callers can update their icon.
 */
export function CollectionPicker({
  postId,
  visible,
  onClose,
  onChange,
  onBeforeReport,
}: {
  postId: string;
  visible: boolean;
  onClose: () => void;
  onChange?: (saved: boolean) => void;
  /**
   * Dismiss EVERY modal above the navigator, not just this one. This picker can be
   * rendered inside the share sheet's own <Modal>, and iOS won't present the report
   * sheet while any modal is still up — it fails silently and wedges the UI. Defaults
   * to `onClose`, which is right when this is the only modal.
   */
  onBeforeReport?: () => void;
}) {
  const theme = useTheme();
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    /* eslint-disable react-hooks/set-state-in-effect -- reset the sheet to a clean state each time it opens */
    setCollections(null);
    setCreating(false);
    setNewName('');
    /* eslint-enable react-hooks/set-state-in-effect */
    void Promise.all([getCollections(), getBookmarkState(postId)])
      .then(([cols, state]) => {
        if (!alive) return;
        setCollections(cols);
        setSaved(state.saved);
        setCurrent(state.collectionId);
      })
      .catch(() => alive && setCollections([]));
    return () => {
      alive = false;
    };
  }, [visible, postId]);

  const saveTo = async (collectionId: string | null) => {
    if (busy) return;
    setBusy(true);
    try {
      await saveBookmark(postId, collectionId);
      setSaved(true);
      setCurrent(collectionId);
      onChange?.(true);
      onClose();
    } catch {
      // leave the sheet open on failure
    } finally {
      setBusy(false);
    }
  };

  const createAndSave = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const id = await createCollection(name);
      await saveBookmark(postId, id);
      setSaved(true);
      onChange?.(true);
      onClose();
    } catch {
      // keep sheet open
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await removeBookmark(postId);
      setSaved(false);
      onChange?.(false);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <ThemedText type="subtitle">Save to</ThemedText>
          {saved ? (
            <Pressable onPress={remove} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove from saved">
              <ThemedText type="smallBold" style={{ color: '#E0563B' }}>Remove</ThemedText>
            </Pressable>
          ) : null}
        </View>

        {collections === null ? (
          <View style={styles.center}><ActivityIndicator color={theme.textSecondary} /></View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 340 }}>
            <Row
              icon="bookmark-outline"
              label="All saved"
              hint="No category"
              selected={saved && current === null}
              onPress={() => saveTo(null)}
              theme={theme}
            />
            {collections.map((c) => (
              <Row
                key={c.id}
                icon="folder-outline"
                label={c.name}
                hint={`${c.item_count}`}
                selected={saved && current === c.id}
                onPress={() => saveTo(c.id)}
                theme={theme}
              />
            ))}

            {creating ? (
              <View style={styles.createRow}>
                <Ionicons name="add-circle-outline" size={22} color={theme.tint} />
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Collection name (e.g. Travel)"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text }]}
                  autoFocus
                  maxLength={40}
                  onSubmitEditing={createAndSave}
                  returnKeyType="done"
                />
                <Pressable onPress={createAndSave} disabled={!newName.trim()} hitSlop={8}>
                  <ThemedText type="smallBold" style={{ color: newName.trim() ? theme.tint : theme.textSecondary }}>
                    Create
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.row} onPress={() => setCreating(true)} accessibilityRole="button">
                <Ionicons name="add" size={22} color={theme.tint} />
                <ThemedText type="default" style={{ color: theme.tint, flex: 1 }}>New collection</ThemedText>
              </Pressable>
            )}
          </ScrollView>
        )}
      </View>
      {/* Closes this sheet first: iOS won't present a modal over a presented one. */}
      <ReportFab onBeforeOpen={onBeforeReport ?? onClose} />
    </Modal>
  );
}

function Row({
  icon,
  label,
  hint,
  selected,
  onPress,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Save to ${label}`}>
      <Ionicons name={icon} size={20} color={theme.text} />
      <ThemedText type="default" numberOfLines={1} style={{ flex: 1 }}>{label}</ThemedText>
      {hint ? <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText> : null}
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={selected ? theme.tint : theme.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32, paddingHorizontal: 16 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.4)', marginTop: 8, marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  center: { paddingVertical: 40, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  input: { flex: 1, fontSize: 16, paddingVertical: 4 },
});

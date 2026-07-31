import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { CollectionPicker } from '@/components/collection-picker';
import { ReportFab } from '@/components/report-issue';
import { ActionMenu } from '@/components/ui/action-menu';
import { useTheme } from '@/hooks/use-theme';
import { trackFirst } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import { getBookmarkState } from '@/lib/bookmarks';
import { awardShare } from '@/lib/points';
import { useAndroidBack } from '@/lib/use-android-back';
import type { Conversation } from '@/lib/messages';
import { POST_REPORT_REASONS, reportPost } from '@/lib/posts';
import { getShareTargets, postLink, sharePost, type SharePerson } from '@/lib/share';

type Target =
  | { key: string; kind: 'conversation'; convo: Conversation; name: string; avatar: string | null; sub: string }
  | { key: string; kind: 'person'; person: SharePerson; name: string; avatar: string | null; sub: string };

export function ShareSheet({
  post,
  allowExternal,
  onClose,
}: {
  post: { id: string; caption: string | null };
  allowExternal: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { user } = useAuth();
  useAndroidBack(true, onClose); // hardware back closes the share sheet
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getBookmarkState(post.id)
      .then((s) => alive && setSaved(s.saved))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [post.id]);

  // Draggable sheet: opens at COLLAPSED, drag the grabber up to EXPANDED (near full
  // screen) or down past a threshold to dismiss.
  const EXPANDED = winH - insets.top - 6;
  const COLLAPSED = Math.min(EXPANDED, Math.round(winH * 0.55) + 40);
  const h = useSharedValue(COLLAPSED); // opens collapsed; the Animated.View slides up on mount
  const startH = useSharedValue(0);
  const pan = Gesture.Pan()
    .onStart(() => {
      startH.value = h.value;
    })
    .onChange((e) => {
      h.value = Math.max(140, Math.min(EXPANDED, startH.value - e.translationY));
    })
    .onEnd((e) => {
      if (h.value < COLLAPSED * 0.55) {
        runOnJS(onClose)();
        return;
      }
      const target = h.value > (COLLAPSED + EXPANDED) / 2 || e.velocityY < -700 ? EXPANDED : COLLAPSED;
      h.value = withSpring(target, { damping: 22, stiffness: 220 });
    });
  const sheetStyle = useAnimatedStyle(() => ({ height: h.value }));

  useEffect(() => {
    void getShareTargets()
      .then(({ conversations, people }) => {
        // direct conversations already cover the other person → don't list them twice
        const directOtherIds = new Set(conversations.filter((c) => c.type === 'direct' && c.other_id).map((c) => c.other_id));
        const convoTargets: Target[] = conversations.map((c) => ({
          key: `c:${c.id}`,
          kind: 'conversation',
          convo: c,
          name: c.type === 'group' ? c.name ?? 'Group' : c.other_display_name ?? c.other_handle ?? 'Chat',
          avatar: c.type === 'group' ? c.avatar_url : c.other_avatar_url,
          sub: c.type === 'group' ? `${c.member_count} members` : `@${c.other_handle ?? ''}`,
        }));
        const peopleTargets: Target[] = people
          .filter((p) => !directOtherIds.has(p.id))
          .map((p) => ({ key: `p:${p.id}`, kind: 'person', person: p, name: p.display_name || p.handle, avatar: p.avatar_url, sub: `@${p.handle}` }));
        setTargets([...convoTargets, ...peopleTargets]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((t) => t.name.toLowerCase().includes(q) || t.sub.toLowerCase().includes(q));
  }, [targets, query]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const send = async () => {
    if (sending || selected.size === 0) return;
    setSending(true);
    try {
      const conversationIds = [...selected].filter((k) => k.startsWith('c:')).map((k) => k.slice(2));
      const recipientIds = [...selected].filter((k) => k.startsWith('p:')).map((k) => k.slice(2));
      await sharePost(post.id, { conversationIds, recipientIds, message });
      awardShare(post.id);
      // Milestone only — never how many or to whom (recipients are a social-graph leak).
      if (user?.id) void trackFirst(user.id, 'first_share');
      setSent(true);
      setTimeout(onClose, 700);
    } catch {
      setSending(false);
    }
  };

  const shareExternally = async () => {
    const url = postLink(post.id);
    const text = post.caption ? `${post.caption} — on Phixr` : 'Check this out on Phixr';
    try {
      await Share.share({ message: `${text} ${url}`, url });
      awardShare(post.id);
      if (user?.id) void trackFirst(user.id, 'first_share');
    } catch {
      /* dismissed */
    }
  };

  const doReport = (reason: string) => {
    reportPost(post.id, reason)
      .then(() => Alert.alert('Thanks for reporting', 'Our team will review this post.'))
      .catch(() => Alert.alert("Couldn't report", 'Please try again in a moment.'));
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.flex}>
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
          <Animated.View
            entering={SlideInDown.springify().damping(22)}
            style={[styles.sheet, sheetStyle, { borderColor: theme.border, backgroundColor: theme.background }]}>
            {/* Drag the grabber to resize/maximise. */}
            <GestureDetector gesture={pan}>
              <View style={styles.grabZone} accessibilityLabel="Drag to resize">
                <View style={[styles.grabber, { backgroundColor: theme.border }]} />
              </View>
            </GestureDetector>

            <View style={styles.headerRow}>
              <ThemedText type="subtitle">Share</ThemedText>
              <View style={styles.headerActions}>
                <Pressable onPress={() => setSaveOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={saved ? 'Saved — edit collection' : 'Save this post'}>
                  <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={20} color={saved ? theme.tint : theme.text} />
                </Pressable>
                <Pressable onPress={() => setReportOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Report this post">
                  <Ionicons name="flag-outline" size={20} color={theme.text} />
                </Pressable>
                <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                  <Ionicons name="close" size={22} color={theme.text} />
                </Pressable>
              </View>
            </View>

            <View style={[styles.body, { paddingBottom: insets.bottom + 8 }]}>
              <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <Ionicons name="search" size={16} color={theme.textSecondary} />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search people & chats" placeholderTextColor={theme.textSecondary} style={[styles.searchInput, { color: theme.text }]} autoCapitalize="none" />
              </View>

              {loading ? (
                <ActivityIndicator style={{ padding: 24 }} color={theme.textSecondary} />
              ) : (
                <FlatList
                  data={shown}
                  keyExtractor={(t) => t.key}
                  keyboardShouldPersistTaps="handled"
                  style={styles.flex}
                  renderItem={({ item }) => {
                    const isSel = selected.has(item.key);
                    return (
                      <Pressable onPress={() => toggle(item.key)} style={styles.row}>
                        {item.avatar ? (
                          <Image source={{ uri: item.avatar }} style={styles.avatar} contentFit="cover" />
                        ) : (
                          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.backgroundSelected }]}>
                            <Ionicons name={item.kind === 'conversation' && item.convo.type === 'group' ? 'people' : 'person'} size={18} color={theme.textSecondary} />
                          </View>
                        )}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <ThemedText type="smallBold" numberOfLines={1}>{item.name}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{item.sub}</ThemedText>
                        </View>
                        <Ionicons name={isSel ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={isSel ? theme.tint : theme.textSecondary} />
                      </Pressable>
                    );
                  }}
                  ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary" style={{ padding: 16, textAlign: 'center' }}>Follow people or start a chat to share here.</ThemedText>}
                />
              )}

              {selected.size > 0 ? (
                <View style={styles.sendRow}>
                  <TextInput value={message} onChangeText={setMessage} placeholder="Add a message…" placeholderTextColor={theme.textSecondary} style={[styles.msgInput, { backgroundColor: theme.backgroundElement, color: theme.text }]} />
                  <Pressable onPress={send} disabled={sending} style={[styles.sendBtn, { backgroundColor: theme.tint }]}>
                    {sending ? <ActivityIndicator color="#fff" /> : <ThemedText type="smallBold" style={{ color: '#fff' }}>{sent ? 'Sent ✓' : `Send (${selected.size})`}</ThemedText>}
                  </Pressable>
                </View>
              ) : null}

              {/* External share is the SECOND option, and disallowed for private posts. */}
              {allowExternal ? (
                <Pressable onPress={shareExternally} style={[styles.external, { borderColor: theme.border }]}>
                  <Ionicons name="share-outline" size={18} color={theme.text} />
                  <ThemedText type="small">Share externally…</ThemedText>
                </Pressable>
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', paddingVertical: 8 }}>
                  Private posts can only be shared in-app with accepted followers.
                </ThemedText>
              )}
            </View>
          </Animated.View>
        </View>

        {/* Rendered at the modal root so its backdrop covers the whole screen, not just the sheet. */}
        <ActionMenu
          visible={reportOpen}
          title="Report this post"
          onClose={() => setReportOpen(false)}
          options={POST_REPORT_REASONS.map((r) => ({ label: r, onPress: () => doReport(r) }))}
        />

        {/* Nested inside this sheet's own <Modal>, so reporting from it has to close
            BOTH — closing only the picker leaves this modal presented and the report
            sheet then fails to present at all. */}
        <CollectionPicker
          postId={post.id}
          visible={saveOpen}
          onClose={() => setSaveOpen(false)}
          onChange={setSaved}
          onBeforeReport={() => {
            setSaveOpen(false);
            onClose();
          }}
        />
      </GestureHandlerRootView>
      {/* Closes this sheet first: iOS won't present a modal over a presented one. */}
      <ReportFab onBeforeOpen={onClose} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14 },
  grabZone: { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  grabber: { width: 40, height: 5, borderRadius: 3 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  body: { flex: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, height: 38, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  sendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  msgInput: { flex: 1, height: 40, borderRadius: 20, paddingHorizontal: 14, fontSize: 14 },
  sendBtn: { paddingHorizontal: 18, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', minWidth: 96 },
  external: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
});

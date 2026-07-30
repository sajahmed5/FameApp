import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionMenu, type ActionOption } from '@/components/ui/action-menu';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { confirm } from '@/lib/confirm';
import { blockUser } from '@/lib/profile';
import { uploadToPipeline } from '@/lib/upload';
import {
  deleteMessage,
  getConversation,
  getMessageReactions,
  getMessages,
  leaveConversation,
  markRead,
  reactToMessage,
  reportConversation,
  reportMessage,
  respondToRequest,
  sendMessage,
  setMuted,
  subscribeToReactions,
  subscribeToThread,
  type ConversationDetail,
  type Message,
  type MessageReaction,
} from '@/lib/messages';

const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '💯'];

const PAGE = 30;
const REPORT_REASONS = ['Spam', 'Harassment or hate', 'Inappropriate content', 'Other'];

// Message images go through the SAME upload pipeline as posts (EXIF strip, adult +
// CSAM scan, transcode). A flagged/removed result is never sent.
async function scanAndUpload(uri: string): Promise<string> {
  const result = await uploadToPipeline({ uri, type: 'image', mime: 'image/jpeg' }, () => {});
  if (result.moderation_status === 'flagged' || result.moderation_status === 'removed') {
    throw new Error('That image was blocked by our safety check.');
  }
  return result.media_url;
}

type Pending = {
  tempId: string;
  body: string | null;
  mediaUri: string | null;
  replyToId: string | null;
  status: 'sending' | 'failed';
  created_at: string;
};

export default function ConversationScreen() {
  'use no memo'; // opt out of React Compiler: it can't model the optimistic async
  // setState-after-await flow here (send → await → reconcile). Behaviour is correct.
  const { id: cid } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const meId = user?.id;

  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const [typingName, setTypingName] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [reportTarget, setReportTarget] = useState<Message | 'conversation' | null>(null);
  const [msgMenu, setMsgMenu] = useState<Message | null>(null);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);

  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const sendTypingRef = useRef<(uid: string, handle: string) => void>(() => {});

  const other = useMemo(() => detail?.members.find((m) => m.id !== meId), [detail, meId]);
  const myHandle = useMemo(() => detail?.members.find((m) => m.id === meId)?.handle ?? 'Someone', [detail, meId]);
  const title = detail?.type === 'group' ? detail?.name ?? 'Group' : other?.display_name ?? other?.handle ?? '';

  const refreshReactions = useCallback(async () => {
    if (!cid) return;
    try {
      setReactions(await getMessageReactions(cid));
    } catch {
      /* ignore */
    }
  }, [cid]);

  const refresh = useCallback(async () => {
    if (!cid) return;
    const [d, msgs] = await Promise.all([getConversation(cid), getMessages(cid, PAGE)]);
    setDetail(d);
    setMessages(msgs);
    setHasOlder(msgs.length === PAGE);
    void markRead(cid);
    void refreshReactions();
  }, [cid, refreshReactions]);

  // React to a message (double-tap → 💯, or the reaction row). Toggles off if I tap the
  // same emoji again. Optimistic; realtime + refetch reconcile.
  const reactTo = useCallback(
    async (messageId: string, emoji: string) => {
      if (!meId) return;
      const mineNow = reactions.find((r) => r.message_id === messageId && r.user_id === meId);
      const target = mineNow?.emoji === emoji ? '' : emoji;
      setReactions((prev) => {
        const others = prev.filter((r) => !(r.message_id === messageId && r.user_id === meId));
        return target ? [...others, { message_id: messageId, user_id: meId, emoji: target }] : others;
      });
      setMsgMenu(null);
      try {
        await reactToMessage(messageId, target);
      } catch {
        void refreshReactions();
      }
    },
    [reactions, meId, refreshReactions],
  );

  // initial load + realtime subscription
  useEffect(() => {
    if (!cid) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount loader for this thread
    setLoading(true);
    void refresh().finally(() => alive && setLoading(false));
    const sub = subscribeToThread(cid, {
      onMessage: () => void refresh(),
      onMemberChange: () => void getConversation(cid).then((d) => alive && setDetail(d)),
      onTyping: ({ userId, handle }) => {
        if (userId === meId) return;
        setTypingName(handle);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTypingName(null), 3500);
      },
    });
    sendTypingRef.current = sub.sendTyping;
    const unsubReacts = subscribeToReactions(() => void refreshReactions());
    return () => {
      alive = false;
      sub.unsubscribe();
      unsubReacts();
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [cid, refresh, refreshReactions, meId]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const older = await getMessages(cid, PAGE, messages[messages.length - 1].created_at);
      setMessages((prev) => [...prev, ...older]);
      setHasOlder(older.length === PAGE);
    } finally {
      setLoadingOlder(false);
    }
  }, [cid, loadingOlder, hasOlder, messages]);

  const onChangeText = useCallback(
    (t: string) => {
      setText(t);
      const now = Date.now();
      if (meId && now - lastTypingSent.current > 1500) {
        lastTypingSent.current = now;
        sendTypingRef.current(meId, myHandle);
      }
    },
    [meId, myHandle],
  );

  const doSend = useCallback(
    async (opts: { body?: string; mediaUri?: string; replyToId?: string; tempId?: string }) => {
      const tempId = opts.tempId ?? `${Date.now()}-${Math.random()}`;
      setPending((prev) => [
        { tempId, body: opts.body ?? null, mediaUri: opts.mediaUri ?? null, replyToId: opts.replyToId ?? null, status: 'sending', created_at: new Date().toISOString() },
        ...prev.filter((p) => p.tempId !== tempId),
      ]);
      try {
        const mediaUrl = opts.mediaUri ? await scanAndUpload(opts.mediaUri) : undefined;
        await sendMessage(cid, { body: opts.body, mediaUrl, replyToId: opts.replyToId });
        await refresh(); // loads the real row; then drop the optimistic placeholder
        setPending((prev) => prev.filter((p) => p.tempId !== tempId));
      } catch (e) {
        setPending((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, status: 'failed' } : p)));
        if (e instanceof Error && e.message.includes('safety')) Alert.alert('Blocked', e.message);
      }
    },
    [cid, refresh],
  );

  const onSendText = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const replyToId = reply?.id;
    setText('');
    setReply(null);
    await doSend({ body, replyToId });
    setSending(false);
  }, [text, sending, reply, doSend]);

  const onAttach = useCallback(async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (res.canceled || !res.assets[0]) return;
    await doSend({ mediaUri: res.assets[0].uri, replyToId: reply?.id });
    setReply(null);
  }, [doSend, reply]);

  // safety + conversation actions (…)
  const menuOptions = useCallback((): ActionOption[] => {
    if (!detail) return [];
    const opts: ActionOption[] = [];
    if (detail.type === 'direct' && other) {
      opts.push({ label: `View @${other.handle}`, onPress: () => router.push({ pathname: '/u/[handle]', params: { handle: other.handle } }) });
    }
    opts.push({ label: detail.members.find((m) => m.id === meId) ? 'Mute' : 'Mute', onPress: () => void setMuted(cid, true) });
    opts.push({ label: 'Report conversation', onPress: () => setReportTarget('conversation') });
    if (detail.type === 'direct' && other) {
      opts.push({
        label: `Block @${other.handle}`,
        destructive: true,
        onPress: async () => {
          if (!(await confirm('Block this user?', 'They can no longer message you.', 'Block'))) return;
          await blockUser(other.id);
          Alert.alert('Blocked', 'They can no longer message you.');
          router.back();
        },
      });
    }
    const isGroup = detail.type === 'group';
    opts.push({
      label: isGroup ? 'Leave group' : 'Delete conversation',
      destructive: true,
      onPress: async () => {
        const ok = await confirm(
          isGroup ? 'Leave this group?' : 'Delete this conversation?',
          isGroup ? 'You will stop receiving its messages.' : 'This removes it from your inbox.',
          isGroup ? 'Leave' : 'Delete',
        );
        if (!ok) return;
        await leaveConversation(cid);
        router.back();
      },
    });
    return opts;
  }, [detail, other, meId, cid]);

  const combined = useMemo<(Message | Pending)[]>(() => [...pending, ...messages], [pending, messages]);

  if (loading) {
    return (
      <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
        <Header title="" onBack={() => router.back()} onMenu={() => {}} theme={theme} />
        <View style={styles.center}><ActivityIndicator color={theme.textSecondary} /></View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <Header title={title} subtitle={detail?.type === 'group' ? `${detail.members.length} members` : `@${other?.handle ?? ''}`} onBack={() => router.back()} onMenu={() => setMenu(true)} onPressTitle={() => router.push({ pathname: '/conversation/details', params: { cid } })} theme={theme} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 44}>
        <FlatList
          data={combined}
          inverted
          keyExtractor={(m) => ('tempId' in m ? m.tempId : m.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
          onEndReachedThreshold={0.3}
          onEndReached={loadOlder}
          ListFooterComponent={loadingOlder ? <ActivityIndicator style={{ padding: 12 }} color={theme.textSecondary} /> : null}
          renderItem={({ item }) => (
            <MessageBubble
              item={item}
              meId={meId}
              isGroup={detail?.type === 'group'}
              seen={isSeen(item, detail, meId)}
              reactions={'tempId' in item ? [] : reactions.filter((r) => r.message_id === item.id)}
              onReact={reactTo}
              onLongPress={(m) => setMsgMenu(m)}
              onRetry={(p) => void doSend({ body: p.body ?? undefined, mediaUri: p.mediaUri ?? undefined, replyToId: p.replyToId ?? undefined, tempId: p.tempId })}
              onOpenPost={(pid) => router.push({ pathname: '/post/[id]', params: { id: pid } })}
              theme={theme}
            />
          )}
        />

        {typingName ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.typing}>
            {typingName} is typing…
          </ThemedText>
        ) : null}

        {/* Request banner: recipient can accept / delete / block */}
        {detail?.pending_incoming ? (
          <RequestBanner
            handle={other?.handle}
            onAccept={async () => { await respondToRequest(cid, true); void refresh(); }}
            onDelete={async () => { await respondToRequest(cid, false); router.back(); }}
            onBlock={async () => { if (other) { await blockUser(other.id); router.back(); } }}
            theme={theme}
          />
        ) : (
          <Composer
            text={text}
            reply={reply}
            onChangeText={onChangeText}
            onSend={onSendText}
            onAttach={onAttach}
            onCancelReply={() => setReply(null)}
            disabled={sending}
            hint={detail?.pending_outgoing ? 'Message request — they must accept before you can send more.' : null}
            bottomInset={insets.bottom}
            theme={theme}
          />
        )}
      </KeyboardAvoidingView>

      <ActionMenu visible={menu} options={menuOptions()} onClose={() => setMenu(false)} />
      <ActionMenu
        visible={!!msgMenu}
        title={msgMenu ? `React:  ${QUICK_REACTIONS.join('   ')}` : undefined}
        options={
          msgMenu
            ? [
                ...QUICK_REACTIONS.map((e) => ({ label: `React ${e}`, onPress: () => void reactTo(msgMenu.id, e) })),
                { label: 'Reply', onPress: () => setReply(msgMenu) },
                ...(msgMenu.sender_id === meId && !msgMenu.deleted_at
                  ? [{ label: 'Delete', destructive: true, onPress: async () => { if (!(await confirm('Delete message?', 'This removes it for everyone.', 'Delete'))) return; await deleteMessage(msgMenu.id); void refresh(); } }]
                  : [{ label: 'Report message', onPress: () => setReportTarget(msgMenu) }]),
              ]
            : []
        }
        onClose={() => setMsgMenu(null)}
      />
      <ActionMenu
        visible={!!reportTarget}
        title="Report"
        options={REPORT_REASONS.map((reason) => ({
          label: reason,
          onPress: async () => {
            const t = reportTarget;
            if (t === 'conversation') await reportConversation(cid, reason);
            else if (t) await reportMessage(t.id, reason);
            Alert.alert('Thanks', 'Our team will review this.');
          },
        }))}
        onClose={() => setReportTarget(null)}
      />
    </ThemedView>
  );
}

function isSeen(item: Message | Pending, detail: ConversationDetail | null, meId?: string): boolean {
  if ('tempId' in item || !detail || detail.type !== 'direct' || item.sender_id !== meId) return false;
  const other = detail.members.find((m) => m.id !== meId);
  return !!other?.last_read_at && other.last_read_at >= item.created_at;
}

function Header({ title, subtitle, onBack, onMenu, onPressTitle, theme }: { title: string; subtitle?: string; onBack: () => void; onMenu: () => void; onPressTitle?: () => void; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      <Pressable onPress={onBack} hitSlop={10}><Ionicons name="chevron-back" size={26} color={theme.text} /></Pressable>
      <Pressable style={{ flex: 1 }} onPress={onPressTitle} disabled={!onPressTitle} accessibilityRole="button" accessibilityLabel="Conversation details">
        <ThemedText type="smallBold" numberOfLines={1}>{title}</ThemedText>
        {subtitle ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{subtitle}</ThemedText> : null}
      </Pressable>
      <Pressable onPress={onMenu} hitSlop={10} accessibilityLabel="Conversation options"><Ionicons name="ellipsis-horizontal" size={22} color={theme.text} /></Pressable>
    </View>
  );
}

function MessageBubble({
  item,
  meId,
  isGroup,
  seen,
  reactions,
  onReact,
  onLongPress,
  onRetry,
  onOpenPost,
  theme,
}: {
  item: Message | Pending;
  meId?: string;
  isGroup?: boolean;
  seen: boolean;
  reactions: MessageReaction[];
  onReact: (messageId: string, emoji: string) => void;
  onLongPress: (m: Message) => void;
  onRetry: (p: Pending) => void;
  onOpenPost: (pid: string) => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const isPending = 'tempId' in item;
  const mine = isPending || item.sender_id === meId;
  const deleted = !isPending && !!item.deleted_at;
  const bubbleColor = mine ? theme.tint : theme.backgroundElement;
  const textColor = mine ? '#fff' : theme.text;
  const lastTap = useRef(0);

  // A 💯 that pops up over the bubble on a double-tap, then fades.
  const burst = useSharedValue(0);
  const burstStyle = useAnimatedStyle(() => ({ opacity: burst.value, transform: [{ scale: 0.5 + burst.value }] }));
  const playBurst = () => {
    // eslint-disable-next-line react-hooks/immutability -- Reanimated shared value, mutated off-render
    burst.value = withSequence(withTiming(1, { duration: 130 }), withTiming(0, { duration: 430 }));
  };

  // Aggregate reactions by emoji (with count + whether I reacted with it).
  const grouped = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const g = grouped.get(r.emoji) ?? { count: 0, mine: false };
    g.count += 1;
    if (r.user_id === meId) g.mine = true;
    grouped.set(r.emoji, g);
  }

  const onTap = () => {
    if (isPending || deleted) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      onReact(item.id, '💯'); // double-tap → 💯
      playBurst();
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  };

  return (
    <Pressable
      onPress={onTap}
      onLongPress={() => !isPending && !deleted && onLongPress(item)}
      style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      <View style={{ maxWidth: '78%' }}>
        {isGroup && !mine && !isPending ? (
          <ThemedText type="small" themeColor="textSecondary" style={{ marginLeft: 8, marginBottom: 2 }}>{item.sender_display_name}</ThemedText>
        ) : null}
        <View style={[styles.bubble, { backgroundColor: deleted ? 'transparent' : bubbleColor, borderColor: theme.border, borderWidth: deleted ? StyleSheet.hairlineWidth : 0 }]}>
          {deleted ? (
            <ThemedText type="small" themeColor="textSecondary" style={{ fontStyle: 'italic' }}>Message deleted</ThemedText>
          ) : (
            <>
              {!isPending && item.reply_to_id ? (
                <View style={[styles.replyQuote, { borderLeftColor: mine ? 'rgba(255,255,255,0.6)' : theme.tint }]}>
                  <ThemedText type="small" style={{ color: mine ? 'rgba(255,255,255,0.85)' : theme.textSecondary }} numberOfLines={1}>
                    {item.reply_sender ? `@${item.reply_sender}: ` : ''}{item.reply_body ?? 'message'}
                  </ThemedText>
                </View>
              ) : null}
              {!isPending && item.shared_post_id ? (
                <Pressable onPress={() => onOpenPost(item.shared_post_id!)} style={[styles.sharedCard, { borderColor: theme.border }]}>
                  {item.shared_thumb ? <Image source={{ uri: item.shared_thumb }} style={styles.sharedThumb} contentFit="cover" /> : null}
                  <View style={{ flex: 1, padding: 8 }}>
                    <ThemedText type="small" style={{ color: textColor, fontWeight: '700' }} numberOfLines={1}>@{item.shared_handle}</ThemedText>
                    <ThemedText type="small" style={{ color: textColor }} numberOfLines={2}>{item.shared_caption ?? 'Shared a post'}</ThemedText>
                  </View>
                </Pressable>
              ) : null}
              {isPending && item.mediaUri ? <Image source={{ uri: item.mediaUri }} style={styles.msgImage} contentFit="cover" /> : null}
              {!isPending && item.media_url ? <Image source={{ uri: item.media_url }} style={styles.msgImage} contentFit="cover" /> : null}
              {item.body ? <ThemedText type="default" style={{ color: textColor }}>{item.body}</ThemedText> : null}
            </>
          )}
        </View>
        {grouped.size > 0 ? (
          <View style={[styles.reactionRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
            {[...grouped.entries()].map(([emoji, g]) => (
              <Animated.View key={emoji} entering={ZoomIn.springify().damping(13).stiffness(200)}>
                <Pressable
                  onPress={() => !isPending && onReact(item.id, emoji)}
                  style={[styles.reactionChip, { backgroundColor: g.mine ? theme.tint : theme.backgroundElement, borderColor: theme.border }]}>
                  <ThemedText type="small" style={{ color: g.mine ? '#fff' : theme.text }}>
                    {emoji}
                    {g.count > 1 ? ` ${g.count}` : ''}
                  </ThemedText>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        ) : null}
        <Animated.Text pointerEvents="none" style={[styles.burst, burstStyle]}>💯</Animated.Text>
        <View style={[styles.meta, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
          {isPending && item.status === 'failed' ? (
            <Pressable onPress={() => onRetry(item)}><ThemedText type="small" style={{ color: theme.danger }}>Failed · Retry</ThemedText></Pressable>
          ) : isPending ? (
            <ThemedText type="small" themeColor="textSecondary">Sending…</ThemedText>
          ) : seen ? (
            <ThemedText type="small" themeColor="textSecondary">Seen</ThemedText>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function RequestBanner({ handle, onAccept, onDelete, onBlock, theme }: { handle?: string | null; onAccept: () => void; onDelete: () => void; onBlock: () => void; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.banner, { borderTopColor: theme.border }]}>
      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', marginBottom: 8 }}>
        {handle ? `@${handle} wants to send you a message.` : 'New message request.'}
      </ThemedText>
      <View style={styles.bannerRow}>
        <Pressable onPress={onBlock} style={[styles.bannerBtn, { borderColor: theme.border }]}><ThemedText type="small" style={{ color: theme.danger }}>Block</ThemedText></Pressable>
        <Pressable onPress={onDelete} style={[styles.bannerBtn, { borderColor: theme.border }]}><ThemedText type="small">Delete</ThemedText></Pressable>
        <Pressable onPress={onAccept} style={[styles.bannerBtn, { backgroundColor: theme.tint, borderColor: theme.tint }]}><ThemedText type="small" style={{ color: '#fff', fontWeight: '700' }}>Accept</ThemedText></Pressable>
      </View>
    </View>
  );
}

function Composer({ text, reply, onChangeText, onSend, onAttach, onCancelReply, disabled, hint, bottomInset, theme }: {
  text: string; reply: Message | null; onChangeText: (t: string) => void; onSend: () => void; onAttach: () => void; onCancelReply: () => void;
  disabled: boolean; hint: string | null; bottomInset: number; theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={[styles.composerWrap, { borderTopColor: theme.border, paddingBottom: Math.max(bottomInset, 8) }]}>
      {reply ? (
        <View style={[styles.replyBar, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="return-up-back" size={16} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={{ flex: 1 }}>Replying to {reply.reply_sender ?? reply.sender_display_name}: {reply.body ?? 'message'}</ThemedText>
          <Pressable onPress={onCancelReply} hitSlop={8}><Ionicons name="close" size={16} color={theme.textSecondary} /></Pressable>
        </View>
      ) : null}
      {hint ? <ThemedText type="small" themeColor="textSecondary" style={{ paddingHorizontal: 12, paddingBottom: 4 }}>{hint}</ThemedText> : null}
      <View style={styles.composer}>
        <Pressable onPress={onAttach} hitSlop={8} accessibilityLabel="Attach image"><Ionicons name="image-outline" size={24} color={theme.textSecondary} /></Pressable>
        <TextInput
          value={text}
          onChangeText={onChangeText}
          placeholder="Message"
          placeholderTextColor={theme.textSecondary}
          style={[styles.composerInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          multiline
        />
        <Pressable onPress={onSend} disabled={disabled || !text.trim()} hitSlop={8} accessibilityLabel="Send">
          <Ionicons name="arrow-up-circle" size={30} color={text.trim() ? theme.tint : theme.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  replyQuote: { borderLeftWidth: 2, paddingLeft: 6, marginBottom: 2 },
  sharedCard: { flexDirection: 'row', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', width: 220 },
  sharedThumb: { width: 64, height: 64 },
  msgImage: { width: 200, height: 200, borderRadius: 10, backgroundColor: '#222' },
  meta: { flexDirection: 'row', marginTop: 2, marginHorizontal: 6 },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3, marginHorizontal: 4 },
  reactionChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  burst: { position: 'absolute', alignSelf: 'center', top: 6, fontSize: 46 },
  typing: { paddingHorizontal: 16, paddingBottom: 4 },
  banner: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  bannerRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  bannerBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 8, borderWidth: 1 },
  composerWrap: { borderTopWidth: StyleSheet.hairlineWidth },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 8, marginTop: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingTop: 6 },
  composerInput: { flex: 1, maxHeight: 120, minHeight: 38, borderRadius: 20, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 15 },
});

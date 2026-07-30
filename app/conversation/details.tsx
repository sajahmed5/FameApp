import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ActionMenu } from '@/components/ui/action-menu';
import { Avatar } from '@/components/ui/avatar';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { confirm } from '@/lib/confirm';
import {
  getConversation,
  getConversationMedia,
  getConversations,
  getSharedGroups,
  leaveConversation,
  reportConversation,
  setMuted,
  type ConversationDetail,
  type SharedGroup,
  type SharedMedia,
} from '@/lib/messages';
import { blockUser } from '@/lib/profile';

const REPORT_REASONS = ['Spam', 'Harassment or bullying', 'Inappropriate content'];

/** Conversation details: shared media, shared groups, and mute/report/block/leave. */
export default function ConversationDetailsScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>();
  const theme = useTheme();
  const { user } = useAuth();
  const meId = user?.id;
  const { width } = useWindowDimensions();

  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [media, setMedia] = useState<SharedMedia[]>([]);
  const [groups, setGroups] = useState<SharedGroup[]>([]);
  const [muted, setMutedState] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reportOpen, setReportOpen] = useState(false);

  const other = useMemo(() => detail?.members.find((m) => m.id !== meId), [detail, meId]);
  const isGroup = detail?.type === 'group';

  const load = useCallback(async () => {
    if (!cid) return;
    setStatus('loading');
    try {
      const d = await getConversation(cid);
      if (!d) {
        setStatus('error');
        return;
      }
      setDetail(d);
      const otherId = d.members.find((m) => m.id !== meId)?.id;
      const [mediaRows, convos, groupRows] = await Promise.all([
        getConversationMedia(cid).catch(() => []),
        getConversations().catch(() => []),
        d.type === 'direct' && otherId ? getSharedGroups(otherId).catch(() => []) : Promise.resolve([]),
      ]);
      setMedia(mediaRows);
      setMutedState(convos.find((c) => c.id === cid)?.muted ?? false);
      setGroups(groupRows);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [cid, meId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-loader
    void load();
  }, [load]);

  const toggleMute = async () => {
    const next = !muted;
    setMutedState(next);
    try {
      await setMuted(cid, next);
    } catch {
      setMutedState(!next);
    }
  };

  const doReport = (reason: string) => {
    void reportConversation(cid, reason)
      .then(() => confirm('Thanks for reporting', 'Our team will review this conversation.', 'OK'))
      .catch(() => {});
  };

  const blockFlow = async () => {
    if (!other) return;
    if (!(await confirm('Block this user?', `@${other.handle} can no longer message you.`, 'Block'))) return;
    await blockUser(other.id);
    router.dismissAll();
  };

  const leaveFlow = async () => {
    const ok = await confirm(
      isGroup ? 'Leave this group?' : 'Delete this conversation?',
      isGroup ? 'You will stop receiving its messages.' : 'This removes it from your inbox.',
      isGroup ? 'Leave' : 'Delete',
    );
    if (!ok) return;
    await leaveConversation(cid);
    router.dismissAll();
  };

  const title = isGroup ? detail?.name ?? 'Group' : other?.display_name ?? other?.handle ?? '';
  const gap = 3;
  const cell = (width - gap * 3) / 4;

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: 'Details' }} />
      {status === 'loading' ? (
        <View style={styles.center}><ActivityIndicator color={theme.textSecondary} /></View>
      ) : status === 'error' ? (
        <View style={styles.center}>
          <ThemedText type="small" themeColor="textSecondary">Couldn&apos;t load this conversation.</ThemedText>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* identity */}
          <Pressable
            style={styles.identity}
            disabled={isGroup || !other}
            onPress={() => other && router.push({ pathname: '/u/[handle]', params: { handle: other.handle } })}>
            <Avatar uri={isGroup ? detail?.avatar_url : other?.avatar_url} name={title} handle={other?.handle} size={84} />
            <ThemedText type="title" style={{ marginTop: 12 }}>{title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {isGroup ? `${detail?.members.length} members` : `@${other?.handle ?? ''}`}
            </ThemedText>
            {!isGroup && other ? (
              <ThemedText type="small" style={{ color: theme.tint, marginTop: 6 }}>View profile</ThemedText>
            ) : null}
          </Pressable>

          {/* actions */}
          <View style={[styles.section, { borderColor: theme.border }]}>
            <Row icon={muted ? 'notifications-off' : 'notifications-outline'} label="Mute notifications" theme={theme}
              right={<Toggle on={muted} theme={theme} />} onPress={toggleMute} />
            <Row icon="flag-outline" label={isGroup ? 'Report group' : 'Report'} theme={theme} onPress={() => setReportOpen(true)} />
            {!isGroup && other ? (
              <Row icon="ban-outline" label={`Block @${other.handle}`} theme={theme} destructive onPress={blockFlow} />
            ) : null}
            <Row icon={isGroup ? 'exit-outline' : 'trash-outline'} label={isGroup ? 'Leave group' : 'Delete conversation'} theme={theme} destructive onPress={leaveFlow} last />
          </View>

          {/* shared media */}
          <SectionTitle>Shared media{media.length ? ` · ${media.length}` : ''}</SectionTitle>
          {media.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyLine}>No photos shared yet.</ThemedText>
          ) : (
            <View style={[styles.grid, { paddingHorizontal: gap }]}>
              {media.slice(0, 40).map((m) => (
                <Image key={m.message_id} source={{ uri: m.media_url }} style={{ width: cell, height: cell, margin: gap / 2, borderRadius: 6 }} contentFit="cover" />
              ))}
            </View>
          )}

          {/* shared groups (direct only) */}
          {!isGroup ? (
            <>
              <SectionTitle>Groups in common{groups.length ? ` · ${groups.length}` : ''}</SectionTitle>
              {groups.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.emptyLine}>No groups in common.</ThemedText>
              ) : (
                groups.map((g) => (
                  <Pressable key={g.id} style={styles.groupRow} onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: g.id } })}>
                    <Avatar uri={g.avatar_url} name={g.name ?? 'Group'} size={40} />
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold" numberOfLines={1}>{g.name ?? 'Group'}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">{g.member_count} members</ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                  </Pressable>
                ))
              )}
            </>
          ) : null}
        </ScrollView>
      )}

      <ActionMenu
        visible={reportOpen}
        title="Report this conversation"
        onClose={() => setReportOpen(false)}
        options={REPORT_REASONS.map((r) => ({ label: r, onPress: () => doReport(r) }))}
      />
    </ThemedView>
  );
}

function Row({
  icon, label, right, onPress, destructive, last, theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  right?: React.ReactNode;
  onPress: () => void;
  destructive?: boolean;
  last?: boolean;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.row, !last && { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Ionicons name={icon} size={20} color={destructive ? theme.danger : theme.text} />
      <ThemedText type="default" style={{ flex: 1, color: destructive ? theme.danger : theme.text }}>{label}</ThemedText>
      {right}
    </Pressable>
  );
}

function Toggle({ on, theme }: { on: boolean; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.toggle, { backgroundColor: on ? theme.tint : theme.backgroundSelected }]}>
      <View style={[styles.knob, { alignSelf: on ? 'flex-end' : 'flex-start' }]} />
    </View>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{children}</ThemedText>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  identity: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 },
  section: { marginHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 14 },
  toggle: { width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: 'center' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 20, paddingTop: 26, paddingBottom: 10 },
  emptyLine: { paddingHorizontal: 20, paddingBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
});

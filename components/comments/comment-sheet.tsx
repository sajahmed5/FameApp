/* eslint-disable react-hooks/immutability -- Reanimated shared values (translateY, the
   animated keyboard) are intentionally mutated from worklets/effects; the rule's
   "don't mutate" heuristic doesn't model shared values. */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommentComposer } from '@/components/comments/comment-composer';
import { CommentItem } from '@/components/comments/comment-item';
import { ReportFab } from '@/components/report-issue';
import { ThemedText } from '@/components/themed-text';
import { ActionMenu, type ActionOption } from '@/components/ui/action-menu';
import { FormMessage } from '@/components/ui/form-message';
import { confirm } from '@/lib/confirm';
import { useAndroidBack } from '@/lib/use-android-back';
import { useComments } from '@/lib/use-comments';
import type { CommentView } from '@/lib/comments';
import { useTheme } from '@/hooks/use-theme';

const REPORT_REASONS = [
  'Spam',
  'Harassment or hate',
  'Inappropriate content',
  "Doesn't match the tags",
  'Other',
];

export function CommentSheet({
  postId,
  onClose,
  onCountDelta,
}: {
  postId: string;
  onClose: () => void;
  onCountDelta?: (delta: number) => void;
}) {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const sheetHeight = Math.round(height * 0.68);

  const c = useComments(postId, onCountDelta);

  const [replyTarget, setReplyTarget] = useState<CommentView | null>(null);
  const [editTarget, setEditTarget] = useState<CommentView | null>(null);
  const [moreTarget, setMoreTarget] = useState<CommentView | null>(null);
  const [reportTarget, setReportTarget] = useState<CommentView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // --- sheet animation -------------------------------------------------------
  const translateY = useSharedValue(sheetHeight);
  const keyboard = useAnimatedKeyboard();

  useEffect(() => {
    translateY.value = withTiming(0, { duration: 260 });
  }, [translateY]);

  const dismiss = useCallback(() => {
    translateY.value = withTiming(sheetHeight, { duration: 220 }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  }, [onClose, sheetHeight, translateY]);

  useAndroidBack(true, dismiss); // hardware back closes the comment sheet, not the post

  const drag = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 700) {
        translateY.value = withTiming(sheetHeight, { duration: 200 }, (finished) => {
          if (finished) runOnJS(onClose)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 22 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    paddingBottom: Math.max(keyboard.height.value, insets.bottom),
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, sheetHeight], [1, 0], Extrapolation.CLAMP),
  }));

  // --- action handlers -------------------------------------------------------
  const openProfile = useCallback(
    (handle: string) => {
      // Open the profile and close the sheet behind it (animated dismiss → onClose).
      router.push({ pathname: '/u/[handle]', params: { handle } });
      dismiss();
    },
    [router, dismiss],
  );

  const onMore = useCallback((comment: CommentView) => setMoreTarget(comment), []);

  const moreOptions = useCallback((): ActionOption[] => {
    const t = moreTarget;
    if (!t) return [];
    if (t.is_own) {
      return [
        { label: 'Edit', onPress: () => setEditTarget(t) },
        {
          label: 'Delete',
          destructive: true,
          onPress: async () => {
            if (await confirm('Delete comment?', 'This cannot be undone.', 'Delete')) {
              try {
                await c.remove(t);
              } catch {
                setNotice("Couldn't delete. Try again.");
              }
            }
          },
        },
      ];
    }
    return [
      { label: 'Report', onPress: () => setReportTarget(t) },
      {
        label: `Block @${t.author_handle}`,
        destructive: true,
        onPress: async () => {
          if (
            await confirm(
              `Block @${t.author_handle}?`,
              'You will no longer see their content.',
              'Block',
            )
          ) {
            try {
              await c.block(t.user_id);
              setNotice('Blocked. Their comments are hidden.');
            } catch {
              setNotice("Couldn't block. Try again.");
            }
          }
        },
      },
    ];
  }, [moreTarget, c]);

  const submitComposer = useCallback(
    async (text: string) => {
      if (editTarget) {
        try {
          await c.edit(editTarget, text);
        } catch {
          setNotice("Couldn't save the edit.");
        }
        setEditTarget(null);
        return;
      }
      const parentId = replyTarget ? (replyTarget.parent_id ?? replyTarget.id) : null;
      await c.submit(text, parentId);
      setReplyTarget(null);
    },
    [c, editTarget, replyTarget],
  );

  const composerContext = editTarget
    ? 'Editing your comment'
    : replyTarget
      ? `Replying to @${replyTarget.author_handle}`
      : null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss}>
      <GestureHandlerRootView style={styles.flex}>
        <View style={styles.overlay}>
      <Animated.View style={[styles.backdropWrap, backdropStyle]}>
        <Pressable
          style={styles.backdropPress}
          onPress={dismiss}
          accessibilityLabel="Close comments"
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          { height: sheetHeight, backgroundColor: theme.background },
          sheetStyle,
        ]}>
        <GestureDetector gesture={drag}>
          <View style={styles.header}>
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />
            <View style={styles.headerRow}>
              <ThemedText type="subtitle">Comments</ThemedText>
              <Pressable onPress={dismiss} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={theme.text} />
              </Pressable>
            </View>
          </View>
        </GestureDetector>

        {notice ? (
          <View style={styles.notice}>
            <FormMessage tone="info">{notice}</FormMessage>
            <Pressable onPress={() => setNotice(null)} hitSlop={8}>
              <Ionicons name="close" size={16} color={theme.textSecondary} />
            </Pressable>
          </View>
        ) : null}

        {c.status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : c.status === 'error' ? (
          <View style={styles.center}>
            <ThemedText type="default" themeColor="textSecondary">
              Couldn&apos;t load comments.
            </ThemedText>
            <Pressable onPress={c.load} hitSlop={8}>
              <ThemedText type="linkPrimary">Retry</ThemedText>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={c.comments}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={c.comments.length === 0 ? styles.center : styles.listContent}
            renderItem={({ item }) => (
              <CommentItem
                comment={item}
                expanded={c.expanded.has(item.id)}
                replies={c.repliesByParent[item.id]}
                loadingReplies={c.loadingReplies.has(item.id)}
                onToggleReplies={() => c.toggleReplies(item.id)}
                onReply={setReplyTarget}
                onReact={c.react}
                onMore={onMore}
                onOpenProfile={openProfile}
                onRetry={c.retry}
              />
            )}
            ListEmptyComponent={
              <ThemedText type="default" themeColor="textSecondary">
                No comments yet. Be the first.
              </ThemedText>
            }
            onEndReachedThreshold={0.4}
            onEndReached={c.loadMore}
            ListFooterComponent={
              c.loadingMore ? (
                <ActivityIndicator style={{ padding: 16 }} color={theme.textSecondary} />
              ) : null
            }
            refreshControl={<RefreshControl refreshing={c.refreshing} onRefresh={c.refresh} />}
          />
        )}

        <CommentComposer
          key={editTarget?.id ?? replyTarget?.id ?? 'new'}
          onSubmit={submitComposer}
          contextLabel={composerContext}
          onCancelContext={
            editTarget
              ? () => setEditTarget(null)
              : replyTarget
                ? () => setReplyTarget(null)
                : undefined
          }
          initialText={editTarget?.body ?? ''}
          autoFocus={!!(editTarget || replyTarget)}
        />
      </Animated.View>

      <ActionMenu
        visible={!!moreTarget}
        options={moreOptions()}
        onClose={() => setMoreTarget(null)}
      />
      <ActionMenu
        visible={!!reportTarget}
        title="Report this comment"
        options={[
          ...REPORT_REASONS.map((reason) => ({
            label: reason,
            onPress: async () => {
              const target = reportTarget;
              if (!target) return;
              try {
                await c.report(target, reason);
                setNotice('Thanks — this comment was reported.');
              } catch {
                setNotice("Couldn't submit the report.");
              }
            },
          })),
          { label: 'Review Community Guidelines', onPress: () => router.push('/legal/guidelines') },
        ]}
        onClose={() => setReportTarget(null)}
      />
        </View>
      </GestureHandlerRootView>
      {/* A <Modal> is its own native window, so the app-wide button can't reach here.
          It has to close this sheet before the report sheet can present — iOS won't
          present a second modal over one that's already up. */}
      <ReportFab onBeforeOpen={dismiss} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  backdropWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  backdropPress: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  header: { paddingTop: 8, paddingHorizontal: 16, paddingBottom: 8 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  listContent: { paddingBottom: 12 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
});

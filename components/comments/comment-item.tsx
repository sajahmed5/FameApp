import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BRAND } from '@/constants/config';
import { REACTION_EMOJIS, type CommentView } from '@/lib/comments';
import { formatRelative } from '@/lib/relative-time';
import { useTheme } from '@/hooks/use-theme';

export type CommentActions = {
  onReply: (c: CommentView) => void;
  onReact: (c: CommentView, emoji: string) => void;
  onMore: (c: CommentView) => void;
  onOpenProfile: (handle: string) => void;
  onRetry: (c: CommentView) => void;
};

type Props = CommentActions & {
  comment: CommentView;
  isReply?: boolean;
  expanded?: boolean;
  replies?: CommentView[];
  loadingReplies?: boolean;
  onToggleReplies?: () => void;
};

export function CommentItem(props: Props) {
  const { comment, isReply, expanded, replies, loadingReplies, onToggleReplies } = props;
  const { onReply, onReact, onMore, onOpenProfile, onRetry } = props;
  const theme = useTheme();
  const [showPicker, setShowPicker] = useState(false);

  const pending = comment._status === 'pending';
  const failed = comment._status === 'failed';
  const emojis = Object.keys(comment.reaction_counts);

  return (
    <View style={[styles.container, isReply && styles.reply, pending && styles.pending]}>
      <Pressable onPress={() => onOpenProfile(comment.author_handle)} disabled={comment.is_deleted}>
        {comment.author_avatar ? (
          <Image
            source={{ uri: comment.author_avatar }}
            style={[styles.avatar, isReply && styles.avatarSmall]}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.avatar,
              isReply && styles.avatarSmall,
              styles.avatarFallback,
              { backgroundColor: theme.backgroundSelected },
            ]}>
            <ThemedText type="small" style={{ fontWeight: '700' }}>
              {(comment.author_name || '?').slice(0, 1).toUpperCase()}
            </ThemedText>
          </View>
        )}
      </Pressable>

      <View style={styles.body}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => onOpenProfile(comment.author_handle)}
            disabled={comment.is_deleted}
            style={styles.nameWrap}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {comment.is_deleted ? 'Deleted' : comment.author_name}
            </ThemedText>
            {!comment.is_deleted ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                @{comment.author_handle}
              </ThemedText>
            ) : null}
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary">
            {formatRelative(comment.created_at)}
            {comment.updated_at !== comment.created_at && !comment.is_deleted ? ' · edited' : ''}
          </ThemedText>
        </View>

        {comment.is_deleted ? (
          <ThemedText type="default" themeColor="textSecondary" style={styles.deleted}>
            This comment was deleted.
          </ThemedText>
        ) : (
          <ThemedText type="default" style={styles.text}>
            {comment.body}
          </ThemedText>
        )}

        {/* Reaction pills */}
        {emojis.length > 0 && !comment.is_deleted ? (
          <View style={styles.reactions}>
            {emojis.map((e) => {
              const mine = comment.my_reactions.includes(e);
              return (
                <Pressable
                  key={e}
                  onPress={() => onReact(comment, e)}
                  style={[
                    styles.pill,
                    {
                      borderColor: mine ? BRAND.accent : theme.border,
                      backgroundColor: mine ? 'rgba(32,138,239,0.12)' : 'transparent',
                    },
                  ]}>
                  <ThemedText type="small">{e}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {comment.reaction_counts[e]}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* Footer actions */}
        {comment.is_deleted ? null : failed ? (
          <View style={styles.footer}>
            <ThemedText type="small" style={{ color: theme.danger }}>
              Failed to post.
            </ThemedText>
            <Pressable onPress={() => onRetry(comment)} hitSlop={6}>
              <ThemedText type="small" style={{ color: BRAND.accent, fontWeight: '700' }}>
                Retry
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.footer}>
            {pending ? (
              <ThemedText type="small" themeColor="textSecondary">
                Posting…
              </ThemedText>
            ) : (
              <>
                <FooterAction label="Reply" onPress={() => onReply(comment)} />
                <Pressable
                  onPress={() => setShowPicker((s) => !s)}
                  hitSlop={6}
                  accessibilityLabel="Add reaction">
                  <Ionicons name="happy-outline" size={16} color={theme.textSecondary} />
                </Pressable>
                <Pressable
                  onPress={() => onMore(comment)}
                  hitSlop={6}
                  accessibilityLabel="More options">
                  <Ionicons name="ellipsis-horizontal" size={16} color={theme.textSecondary} />
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* Inline emoji picker */}
        {showPicker && !comment.is_deleted ? (
          <View
            style={[
              styles.picker,
              { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}>
            {REACTION_EMOJIS.map((e) => (
              <Pressable
                key={e}
                onPress={() => {
                  setShowPicker(false);
                  onReact(comment, e);
                }}
                hitSlop={4}
                style={styles.pickerEmoji}>
                <ThemedText type="default">{e}</ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Replies (top-level only) */}
        {!isReply && comment.reply_count > 0 ? (
          <View style={styles.repliesBlock}>
            <Pressable onPress={onToggleReplies} hitSlop={6} style={styles.viewReplies}>
              <View style={[styles.replyLine, { backgroundColor: theme.border }]} />
              <ThemedText type="small" themeColor="textSecondary" style={{ fontWeight: '600' }}>
                {expanded
                  ? 'Hide replies'
                  : `View ${comment.reply_count} ${comment.reply_count === 1 ? 'reply' : 'replies'}`}
              </ThemedText>
              {loadingReplies ? (
                <ActivityIndicator size="small" color={theme.textSecondary} />
              ) : null}
            </Pressable>
            {expanded
              ? (replies ?? []).map((r) => (
                  <CommentItem
                    key={r.id}
                    comment={r}
                    isReply
                    onReply={onReply}
                    onReact={onReact}
                    onMore={onMore}
                    onOpenProfile={onOpenProfile}
                    onRetry={onRetry}
                  />
                ))
              : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function FooterAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6}>
      <ThemedText type="small" themeColor="textSecondary" style={{ fontWeight: '600' }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', gap: 10, paddingVertical: 10, paddingHorizontal: 14 },
  reply: { paddingLeft: 0, paddingVertical: 8 },
  pending: { opacity: 0.6 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarSmall: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 4 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nameWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flex: 1 },
  text: { lineHeight: 20 },
  deleted: { fontStyle: 'italic' },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 2 },
  picker: {
    flexDirection: 'row',
    gap: 10,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 4,
  },
  pickerEmoji: { padding: 2 },
  repliesBlock: { marginTop: 6, gap: 2 },
  viewReplies: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  replyLine: { width: 24, height: StyleSheet.hairlineWidth },
});

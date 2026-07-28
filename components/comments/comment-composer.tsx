import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { COMMENT_MAX_LENGTH } from '@/lib/comments';
import { useTheme } from '@/hooks/use-theme';

type ComposerProps = {
  onSubmit: (text: string) => void | Promise<void>;
  /** Banner shown above the input; e.g. reply target or edit mode. */
  contextLabel?: string | null;
  onCancelContext?: () => void;
  initialText?: string;
  autoFocus?: boolean;
};

// Quick emojis that insert into the comment field (like Instagram's row).
const QUICK_EMOJIS = ['❤️', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];

const COUNTER_SHOWS_AT = COMMENT_MAX_LENGTH - 100;

export function CommentComposer({
  onSubmit,
  contextLabel,
  onCancelContext,
  initialText = '',
  autoFocus,
}: ComposerProps) {
  const theme = useTheme();
  // The sheet remounts this composer (keyed by mode) when switching to reply/edit,
  // so the initial text is picked up here without a syncing effect.
  const [text, setText] = useState(initialText);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = text.trim();
  const overLimit = text.length > COMMENT_MAX_LENGTH;
  const canSend = trimmed.length > 0 && !overLimit && !submitting;

  async function send() {
    if (!canSend) return;
    setSubmitting(true);
    try {
      await onSubmit(text);
      setText('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View
      style={[styles.wrap, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
      {contextLabel ? (
        <View style={styles.context}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.contextText}>
            {contextLabel}
          </ThemedText>
          {onCancelContext ? (
            <Pressable accessibilityLabel="Cancel" onPress={onCancelContext} hitSlop={8}>
              <Ionicons name="close" size={16} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.emojiBar}>
        {QUICK_EMOJIS.map((e) => (
          <Pressable
            key={e}
            accessibilityLabel={`Add ${e}`}
            onPress={() => setText((t) => (t + e).slice(0, COMMENT_MAX_LENGTH))}
            hitSlop={4}
            style={styles.emojiButton}>
            <ThemedText type="default" style={styles.emoji}>
              {e}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <View style={styles.row}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Add a comment…"
          placeholderTextColor={theme.textSecondary}
          multiline
          autoFocus={autoFocus}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          maxLength={COMMENT_MAX_LENGTH + 20}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send comment"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={send}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: canSend ? '#208AEF' : theme.backgroundSelected },
            pressed && canSend ? { opacity: 0.85 } : null,
          ]}>
          <Ionicons name="arrow-up" size={20} color={canSend ? '#fff' : theme.textSecondary} />
        </Pressable>
      </View>

      {text.length >= COUNTER_SHOWS_AT ? (
        <ThemedText
          type="small"
          style={[styles.counter, { color: overLimit ? theme.danger : theme.textSecondary }]}>
          {text.length}/{COMMENT_MAX_LENGTH}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  context: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  contextText: { flex: 1 },
  emojiBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingBottom: 4,
  },
  emojiButton: { padding: 4 },
  emoji: { fontSize: 24 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
  },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  counter: { alignSelf: 'flex-end', paddingRight: 6 },
});

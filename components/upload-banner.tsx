import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { useUpload } from '@/lib/upload-manager';

/**
 * App-wide status for a composition that's uploading/posting in the background. Hidden
 * on the compose screen itself (which shows its own status). Lets the user navigate away
 * while an upload continues, notifies on completion, and offers retry on failure — all
 * without re-entering the caption/tags (the draft is held in the manager).
 */
export function UploadBanner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { composition, retryUpload, submit, clear } = useUpload();

  // Auto-dismiss the success banner shortly after posting.
  useEffect(() => {
    if (composition?.postedId) {
      const t = setTimeout(() => clear(), 4000);
      return () => clearTimeout(t);
    }
  }, [composition?.postedId, clear]);

  if (!composition || pathname === '/compose') return null;

  const { phase, progress, posting, postedId, postError, submitRequested } = composition;

  let content: {
    icon: keyof typeof Ionicons.glyphMap;
    text: string;
    action?: { label: string; onPress: () => void };
    tone: 'info' | 'success' | 'error';
  } | null = null;

  if (postedId) {
    content = { icon: 'checkmark-circle', text: 'Posted', tone: 'success' };
  } else if (postError) {
    content = {
      icon: 'alert-circle',
      text: "Couldn't post",
      tone: 'error',
      action: { label: 'Retry', onPress: submit },
    };
  } else if (phase === 'failed') {
    content = {
      icon: 'cloud-offline',
      text: 'Upload failed',
      tone: 'error',
      action: { label: 'Retry', onPress: retryUpload },
    };
  } else if (phase === 'rejected') {
    content = {
      icon: 'close-circle',
      text: "This media can't be posted",
      tone: 'error',
      action: { label: 'Dismiss', onPress: clear },
    };
  } else if (posting || (phase === 'uploading' && submitRequested)) {
    content = {
      icon: 'cloud-upload',
      text: `Posting… ${Math.round(progress * 100)}%`,
      tone: 'info',
    };
  } else if (phase === 'uploading') {
    content = {
      icon: 'cloud-upload',
      text: `Uploading… ${Math.round(progress * 100)}%`,
      tone: 'info',
      action: { label: 'Open', onPress: () => router.push('/compose') },
    };
  } else if (phase === 'ready') {
    content = {
      icon: 'checkmark-circle',
      text: 'Ready to post',
      tone: 'info',
      action: { label: 'Finish', onPress: () => router.push('/compose') },
    };
  }
  if (!content) return null;

  const toneColor =
    content.tone === 'success' ? '#2E7D46' : content.tone === 'error' ? theme.danger : theme.text;

  return (
    <View style={[styles.wrap, { top: insets.top + 6 }]} pointerEvents="box-none">
      <View
        style={[
          styles.banner,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        <Ionicons name={content.icon} size={18} color={toneColor} />
        <ThemedText type="small" style={styles.text} numberOfLines={1}>
          {content.text}
        </ThemedText>
        {content.action ? (
          <Pressable onPress={content.action.onPress} hitSlop={8} accessibilityRole="button">
            <ThemedText type="smallBold" style={{ color: BRAND.accent }}>
              {content.action.label}
            </ThemedText>
          </Pressable>
        ) : null}
        {/* Cancel an in-progress upload/post (aborts the transfer + drops the draft). */}
        {content.tone === 'info' ? (
          <Pressable onPress={clear} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel upload">
            <Ionicons name="close" size={16} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: '92%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  text: { flexShrink: 1 },
});

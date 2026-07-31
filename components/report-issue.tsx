import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { usePathname } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BRAND, TAB_BAR_CLEARANCE } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { submitFeedback, type FeedbackKind } from '@/lib/feedback';

const KINDS: { key: FeedbackKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'bug', label: 'Something’s broken', icon: 'bug-outline' },
  { key: 'idea', label: 'Idea / suggestion', icon: 'bulb-outline' },
  { key: 'other', label: 'Something else', icon: 'chatbox-ellipses-outline' },
];

/**
 * App-wide "report an issue" affordance.
 *
 * Wraps the whole app so the screen can be captured: `children` sit inside a
 * capture target, while the floating button and the report sheet render OUTSIDE it.
 * That ordering matters twice over —
 *   1. the screenshot is taken the instant the button is pressed, BEFORE the sheet
 *      opens, so it shows the problem rather than the report form;
 *   2. the button itself is outside the capture target, so it doesn't appear in the
 *      shot either.
 */
export function ReportIssueProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { user } = useAuth();

  const captureTarget = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [includeShot, setIncludeShot] = useState(true);
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentRef, setSentRef] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openSheet = useCallback(async () => {
    // Capture FIRST, then open — otherwise every screenshot would just be the sheet.
    let uri: string | null = null;
    try {
      if (captureTarget.current) {
        uri = await captureRef(captureTarget.current, {
          format: 'jpg',
          quality: 0.7,
          result: Platform.OS === 'web' ? 'data-uri' : 'tmpfile',
        });
      }
    } catch {
      uri = null; // capture is a nicety, never a blocker
    }
    setShot(uri);
    setIncludeShot(!!uri);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setShot(null);
    setMessage('');
    setKind('bug');
    setSentRef(null);
    setError(null);
  }, []);

  const send = useCallback(async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const { ref } = await submitFeedback({
        kind,
        message,
        route: pathname,
        screenshotUri: includeShot ? shot : null,
      });
      setSentRef(ref);
    } catch {
      setError('Could not send that report. Please try again.');
    } finally {
      setSending(false);
    }
  }, [message, sending, kind, pathname, includeShot, shot]);

  return (
    <View style={styles.fill}>
      {/* Everything the screenshot should contain. */}
      <View ref={captureTarget} collapsable={false} style={styles.fill}>
        {children}
      </View>

      {/* Signed-in only: reports are attributed, and the sheet needs an account. */}
      {user ? (
        <Pressable
          onPress={openSheet}
          accessibilityRole="button"
          accessibilityLabel="Report a problem with the app"
          style={[styles.fab, { bottom: insets.bottom + TAB_BAR_CLEARANCE + 8 }]}>
          <Ionicons name="bug" size={16} color="#fff" />
        </Pressable>
      ) : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ThemedView style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />
            {sentRef ? (
              <View style={styles.done}>
                <Ionicons name="checkmark-circle" size={44} color={BRAND.accent} />
                <ThemedText type="subtitle">Reported as #{sentRef}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                  Thanks — quote #{sentRef} if you want to talk about this one.
                </ThemedText>
                <Pressable onPress={close} style={[styles.primary, { backgroundColor: BRAND.accent }]}>
                  <ThemedText type="smallBold" style={{ color: '#fff' }}>Done</ThemedText>
                </Pressable>
              </View>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
                <ThemedText type="subtitle">Report an issue</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: 12 }}>
                  On {pathname || 'this screen'}
                </ThemedText>

                <View style={styles.kinds}>
                  {KINDS.map((k) => {
                    const on = kind === k.key;
                    return (
                      <Pressable
                        key={k.key}
                        onPress={() => setKind(k.key)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={[
                          styles.kind,
                          { borderColor: on ? BRAND.accent : theme.border, backgroundColor: on ? BRAND.accent : 'transparent' },
                        ]}>
                        <Ionicons name={k.icon} size={15} color={on ? '#fff' : theme.text} />
                        <ThemedText type="small" style={{ color: on ? '#fff' : theme.text }}>
                          {k.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>

                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="What happened, and what did you expect instead?"
                  placeholderTextColor={theme.textSecondary}
                  multiline
                  style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                  autoFocus
                />

                {shot ? (
                  <Pressable
                    onPress={() => setIncludeShot((v) => !v)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: includeShot }}
                    style={styles.shotRow}>
                    <Ionicons
                      name={includeShot ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={includeShot ? BRAND.accent : theme.textSecondary}
                    />
                    <ThemedText type="small" style={{ flex: 1 }}>Include a screenshot of this screen</ThemedText>
                    <Image source={{ uri: shot }} style={[styles.thumb, { borderColor: theme.border }]} contentFit="cover" />
                  </Pressable>
                ) : null}

                {error ? (
                  <ThemedText type="small" style={{ color: theme.danger, marginTop: 8 }}>{error}</ThemedText>
                ) : null}

                <Pressable
                  onPress={send}
                  disabled={!message.trim() || sending}
                  style={[
                    styles.primary,
                    { backgroundColor: BRAND.accent, opacity: !message.trim() || sending ? 0.5 : 1 },
                  ]}>
                  {sending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: '#fff' }}>Send report</ThemedText>
                  )}
                </Pressable>
              </ScrollView>
            )}
          </ThemedView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fab: {
    position: 'absolute',
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 40,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 4 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.4)', marginBottom: 10 },
  kinds: { gap: 8, marginBottom: 12 },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, minHeight: 96, fontSize: 15, textAlignVertical: 'top' },
  shotRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  thumb: { width: 44, height: 60, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  primary: { marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  done: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  center: { textAlign: 'center' },
});

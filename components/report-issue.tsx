import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { usePathname } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { captureRef, captureScreen } from 'react-native-view-shot';
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

const ReportIssueContext = createContext<{ open: () => void } | null>(null);

/**
 * Opens the report sheet from anywhere. Needed because a react-native `<Modal>` renders
 * in its own native window, so the provider's floating button can never paint over one —
 * modal-based sheets have to mount their own {@link ReportFab} (or call this directly).
 */
export function useReportIssue() {
  const ctx = useContext(ReportIssueContext);
  if (!ctx) throw new Error('useReportIssue must be used inside a ReportIssueProvider');
  return ctx;
}

/** Tracks the on-screen keyboard so the button can sit above it rather than behind it. */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    // `will*` on iOS keeps the button in step with the keyboard's animation.
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/**
 * The floating bug button. The provider mounts one automatically; mount another inside
 * any `<Modal>` so the affordance stays reachable there too.
 */
export function ReportFab({ style }: { style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { open } = useReportIssue();
  const keyboard = useKeyboardHeight();

  // Reports are attributed, and the sheet needs an account.
  if (!user) return null;

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel="Report a problem with the app"
      style={[
        styles.fab,
        { bottom: keyboard > 0 ? keyboard + 12 : insets.bottom + TAB_BAR_CLEARANCE + 8 },
        style,
      ]}>
      <Ionicons name="bug" size={16} color="#fff" />
    </Pressable>
  );
}

/**
 * App-wide "report an issue" affordance.
 *
 * The screenshot is taken the instant the button is pressed, BEFORE the sheet opens, so
 * it shows the problem rather than the report form. On native it uses `captureScreen`
 * rather than `captureRef` so that content in a react-native `<Modal>` — which lives in
 * a separate native window, outside our React tree — is actually in the shot. The
 * trade-off is that the bug button itself appears in the corner of the capture; the web
 * fallback still uses `captureRef`, since `captureScreen` has no web implementation.
 */
export function ReportIssueProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  const captureTarget = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [includeShot, setIncludeShot] = useState(true);
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentRef, setSentRef] = useState<number | null>(null);
  const [shotFailed, setShotFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openSheet = useCallback(async () => {
    // Capture FIRST, then open — otherwise every screenshot would just be the sheet.
    let uri: string | null = null;
    try {
      if (Platform.OS === 'web') {
        uri = captureTarget.current
          ? await captureRef(captureTarget.current, { format: 'jpg', quality: 0.7, result: 'data-uri' })
          : null;
      } else {
        uri = await captureScreen({ format: 'jpg', quality: 0.7, result: 'tmpfile' });
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
    setShotFailed(false);
    setError(null);
  }, []);

  const send = useCallback(async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const { ref, screenshotFailed } = await submitFeedback({
        kind,
        message,
        route: pathname,
        screenshotUri: includeShot ? shot : null,
      });
      setShotFailed(screenshotFailed);
      setSentRef(ref);
    } catch {
      setError('Could not send that report. Please try again.');
    } finally {
      setSending(false);
    }
  }, [message, sending, kind, pathname, includeShot, shot]);

  const ctx = useMemo(() => ({ open: openSheet }), [openSheet]);

  return (
    <ReportIssueContext.Provider value={ctx}>
      <View style={styles.fill}>
        {/* Capture target for the web fallback; native uses captureScreen. */}
        <View ref={captureTarget} collapsable={false} style={styles.fill}>
          {children}
        </View>

        <ReportFab />

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
                {shotFailed ? (
                  <ThemedText type="small" style={[styles.center, { color: theme.danger }]}>
                    The screenshot couldn’t be uploaded, so this report went without one.
                  </ThemedText>
                ) : null}
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
    </ReportIssueContext.Provider>
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

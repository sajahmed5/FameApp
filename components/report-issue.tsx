import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Updates from 'expo-updates';
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
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { captureRef, captureScreen } from 'react-native-view-shot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { notify } from '@/lib/confirm';
import { MAX_ATTACHMENTS, submitFeedback, type FeedbackKind } from '@/lib/feedback';
import { Sentry, sentryEnabled } from '@/lib/sentry';

const KINDS: { key: FeedbackKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'bug', label: 'Something’s broken', icon: 'bug-outline' },
  { key: 'idea', label: 'Idea / suggestion', icon: 'bulb-outline' },
  { key: 'other', label: 'Something else', icon: 'chatbox-ellipses-outline' },
];

const FAB_SIZE = 34;
const FAB_MARGIN = 10;
const FAB_POS_KEY = 'phixr.reportFab.pos';

type FabPos = { x: number; y: number };

/**
 * Native build number plus a short OTA update id. Shown in the sheet so a screenshot
 * alone answers "which bundle was this?" — an update applies on the launch AFTER it
 * downloads, so the build number on its own can't distinguish a shipped fix from the
 * bundle it replaced.
 */
const BUILD_LABEL = `${Application.nativeBuildVersion ?? '?'}·${
  Updates.updateId ? Updates.updateId.slice(0, 8) : 'embedded'
}`;

const ReportIssueContext = createContext<{
  open: (beforeOpen?: () => void) => void;
  pos: FabPos | null;
  setPos: (p: FabPos) => void;
} | null>(null);

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

/**
 * The floating bug button. The provider mounts one automatically; mount another inside
 * any `<Modal>` so the affordance stays reachable there too.
 */
export function ReportFab({
  style,
  onBeforeOpen,
}: {
  style?: StyleProp<ViewStyle>;
  /** Mounted inside a <Modal>? Pass its dismiss — see the note in openSheet. */
  onBeforeOpen?: () => void;
}) {
  const { open, pos, setPos } = useReportIssue();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();

  const minY = insets.top + 8;
  const maxY = winH - insets.bottom - FAB_SIZE - 8;
  const rightX = winW - FAB_SIZE - FAB_MARGIN;
  const resting: FabPos = pos ?? { x: rightX, y: Math.round(winH * 0.45) };

  // Live position during a drag; null when not dragging.
  const [drag, setDrag] = useState<FabPos | null>(null);
  const { x: restX, y: restY } = resting;
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Let taps through to the Pressable; only claim the touch once it actually moves.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
        onPanResponderMove: (_e, g) => setDrag({ x: restX + g.dx, y: restY + g.dy }),
        onPanResponderRelease: (_e, g) => {
          const x = restX + g.dx;
          // Snap to whichever side it's nearest, so it never sits stranded mid-screen.
          setPos({
            x: x + FAB_SIZE / 2 < winW / 2 ? FAB_MARGIN : rightX,
            y: Math.max(minY, Math.min(maxY, restY + g.dy)),
          });
          setDrag(null);
        },
        onPanResponderTerminate: () => setDrag(null),
      }),
    // `resting` only changes on release, so the responder is never rebuilt mid-drag.
    [restX, restY, minY, maxY, rightX, winW, setPos],
  );

  const at = drag ?? resting;

  return (
    <View
      {...responder.panHandlers}
      style={[styles.fab, { left: at.x, top: at.y }, drag ? styles.fabDragging : null, style]}>
      <Pressable
        // No drag-vs-tap guard needed: once the pan responder claims the touch the
        // Pressable is cancelled, so a drag can't also fire a press.
        onPress={() => open(onBeforeOpen)}
        // Long-press: prove whether this device can reach Sentry at all. "No crashes
        // reported" and "crash reporting isn't running" look identical otherwise.
        onLongPress={() => {
          if (!sentryEnabled()) {
            notify('Crash reporting is OFF', 'Sentry did not initialise — no DSN in this build.');
            return;
          }
          Sentry.captureMessage('Phixr test event (long-press on the report button)', 'error');
          notify('Test event sent', 'Check sentry.io — it should appear within a few seconds.');
        }}
        accessibilityRole="button"
        accessibilityLabel="Report a problem with the app. Drag to move it out of the way."
        style={styles.fabHit}>
        <Ionicons name="bug" size={16} color="#fff" />
      </Pressable>
    </View>
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
  // Signed-out reports go through an anon RPC that takes no attachment.
  const { user } = useAuth();

  const captureTarget = useRef<View>(null);
  const [open, setOpen] = useState(false);
  /** Attachments in the order they'll be shown. [0] is the auto-capture when it worked. */
  const [shots, setShots] = useState<string[]>([]);
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentRef, setSentRef] = useState<number | null>(null);
  const [failedCount, setFailedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const openSheet = useCallback(async (beforeOpen?: () => void) => {
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
    setShots(uri ? [uri] : []);

    // iOS presents a <Modal> from the root view controller and refuses to present a
    // second one while the first is up — it fails SILENTLY, leaving this sheet "open"
    // but invisible and eating every touch. So a host modal dismisses itself first
    // (after the capture, so the shot still shows the screen being reported), and we
    // wait for its dismissal animation before presenting.
    if (beforeOpen) {
      beforeOpen();
      setTimeout(() => setOpen(true), 350);
      return;
    }
    setOpen(true);
  }, []);

  const addFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: MAX_ATTACHMENTS,
    });
    if (res.canceled || !res.assets?.length) return;
    setShots((prev) => [...prev, ...res.assets.map((a) => a.uri)].slice(0, MAX_ATTACHMENTS));
  }, []);

  const removeShot = useCallback((i: number) => {
    setShots((prev) => prev.filter((_, n) => n !== i));
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setShots([]);
    setMessage('');
    setKind('bug');
    setSentRef(null);
    setFailedCount(0);
    setError(null);
  }, []);

  const send = useCallback(async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const { ref, failedAttachments } = await submitFeedback({
        kind,
        message,
        route: pathname,
        screenshotUris: shots,
      });
      setFailedCount(failedAttachments);
      setSentRef(ref);
    } catch {
      setError('Could not send that report. Please try again.');
    } finally {
      setSending(false);
    }
  }, [message, sending, kind, pathname, shots]);

  // Where the user has dragged the button to. Held here rather than in ReportFab so the
  // several instances (root, each modal host, the editor) all agree, and persisted so it
  // stays where it was put.
  const [fabPos, setFabPos] = useState<FabPos | null>(null);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(FAB_POS_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const p = JSON.parse(raw) as FabPos;
        if (typeof p?.x === 'number' && typeof p?.y === 'number') setFabPos(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const setPos = useCallback((p: FabPos) => {
    setFabPos(p);
    AsyncStorage.setItem(FAB_POS_KEY, JSON.stringify(p)).catch(() => {});
  }, []);

  const ctx = useMemo(
    () => ({ open: openSheet, pos: fabPos, setPos }),
    [openSheet, fabPos, setPos],
  );

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
            {/* Tapping the backdrop closes too, but that isn't discoverable when the
                sheet is tall enough to leave barely any backdrop showing. */}
            <Pressable
              onPress={close}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={[styles.sheetClose, { backgroundColor: theme.backgroundSelected }]}>
              <Ionicons name="close" size={17} color={theme.text} />
            </Pressable>
            {sentRef ? (
              <View style={styles.done}>
                <Ionicons name="checkmark-circle" size={44} color={BRAND.accent} />
                <ThemedText type="subtitle">Reported as #{sentRef}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                  Thanks — quote #{sentRef} if you want to talk about this one.
                </ThemedText>
                {failedCount > 0 ? (
                  <ThemedText type="small" style={[styles.center, { color: theme.danger }]}>
                    {failedCount === 1
                      ? 'One attachment couldn’t be uploaded, so it isn’t on this report.'
                      : `${failedCount} attachments couldn’t be uploaded, so they aren’t on this report.`}
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
                  On {pathname || 'this screen'} · build {BUILD_LABEL}
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

                {/* The first tile is the auto-capture of the screen behind the sheet;
                    the rest come from the library, because not every problem is visible
                    on the screen you happen to be on (#13). Any of them can be removed. */}
                <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: 14 }}>
                  {user
                    ? `Attachments ${shots.length}/${MAX_ATTACHMENTS}`
                    : 'Sign in to attach a screenshot. Your description still reaches us.'}
                </ThemedText>
                <View style={[styles.thumbRow, !user && { display: 'none' }]}>
                  {shots.map((uri, i) => (
                    <View key={`${uri}-${i}`}>
                      <Image
                        source={{ uri }}
                        style={[styles.thumb, { borderColor: theme.border }]}
                        contentFit="cover"
                      />
                      <Pressable
                        onPress={() => removeShot(i)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove attachment ${i + 1}`}
                        style={styles.thumbRemove}>
                        <Ionicons name="close" size={13} color="#fff" />
                      </Pressable>
                    </View>
                  ))}
                  {shots.length < MAX_ATTACHMENTS ? (
                    <Pressable
                      onPress={addFromLibrary}
                      accessibilityRole="button"
                      accessibilityLabel="Add a photo from your library"
                      style={[styles.thumbAdd, { borderColor: theme.border }]}>
                      <Ionicons name="add" size={22} color={theme.textSecondary} />
                    </Pressable>
                  ) : null}
                </View>

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
  /**
   * Anchored to the middle of the right edge, NOT a corner.
   *
   * The bottom-right corner was wrong: it offset by TAB_BAR_CLEARANCE, which is only
   * correct on the four tab screens that actually show the floating bar. Everywhere
   * else it floated into whatever owns the bottom-right — landing fully inside the
   * Messages "New message" button and stealing its touch, inside the camera's shutter
   * cluster, on sheet row checkmarks, and over inline Save buttons. Moving it to the
   * top-right while the keyboard was up only traded those for the story viewer's close
   * and ⋯ controls and the upload banner.
   *
   * The vertical middle of the right edge is empty on every screen in the app, and it
   * sits above any keyboard, so no keyboard tracking is needed either.
   */
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    opacity: 0.75,
    zIndex: 40,
  },
  fabDragging: { opacity: 1, transform: [{ scale: 1.15 }] },
  fabHit: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 4 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.4)', marginBottom: 10 },
  sheetClose: {
    position: 'absolute',
    top: 10,
    right: 14,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  kinds: { gap: 8, marginBottom: 12 },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, minHeight: 96, fontSize: 15, textAlignVertical: 'top' },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbAdd: {
    width: 44,
    height: 60,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: 44, height: 60, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  primary: { marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  done: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  center: { textAlign: 'center' },
});

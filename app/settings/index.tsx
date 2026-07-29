import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import {
  deleteAccount,
  exportMyData,
  getNotificationPrefs,
  setNotificationPrefs,
  setPrivacy,
  setSearchRadius,
  type NotificationPrefs,
} from '@/lib/profile';

const RADII = [1, 5, 10, 25, 50];

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile, reload, signOut } = useAuth();

  const [isPrivate, setIsPrivate] = useState(profile?.is_private ?? false);
  const [radius, setRadius] = useState(profile?.search_radius_miles ?? 5);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [shareUsage, setShareUsage] = useState(!analytics.isOptedOut());
  const [busy, setBusy] = useState<string | null>(null);

  async function toggleUsage(v: boolean) {
    setShareUsage(v);
    // value ON = analytics enabled; OFF = opted out. Honoured before any event fires.
    await analytics.setOptOut(!v);
  }

  const loadPrefs = useCallback(async () => {
    setPrefs(await getNotificationPrefs().catch(() => null));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-loader
    void loadPrefs();
  }, [loadPrefs]);

  async function togglePrivacy(v: boolean) {
    setIsPrivate(v);
    try {
      await setPrivacy(v);
      reload();
    } catch {
      setIsPrivate(!v);
    }
  }
  async function changeRadius(m: number) {
    setRadius(m);
    try {
      await setSearchRadius(m);
      reload();
    } catch {
      /* keep optimistic */
    }
  }
  async function togglePref(key: keyof NotificationPrefs, v: boolean) {
    if (!prefs) return;
    const next = { ...prefs, [key]: v };
    setPrefs(next);
    await setNotificationPrefs(next).catch(() => setPrefs(prefs));
  }

  async function onExport() {
    setBusy('export');
    try {
      const data = await exportMyData();
      const file = new File(Paths.cache, 'fame-data-export.json');
      if (file.exists) file.delete();
      file.create();
      file.write(JSON.stringify(data, null, 2));
      await Share.share({ url: file.uri, title: 'My Fame data' });
    } catch {
      Alert.alert('Export failed', 'Could not export your data. Try again.');
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete account',
      'This permanently erases your account, posts, and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Are you absolutely sure?',
              'There is no way to recover your account after this.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    setBusy('delete');
                    try {
                      await deleteAccount();
                    } catch {
                      // signs out → root guard routes to login
                      Alert.alert('Delete failed', 'Could not delete your account. Try again.');
                      setBusy(null);
                    }
                  },
                },
              ],
            ),
        },
      ],
    );
  }

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: 'Settings' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Group title="Privacy">
          <ToggleRow
            label="Private account"
            sublabel="Only accepted followers can see your posts."
            value={isPrivate}
            onValueChange={togglePrivacy}
          />
          <ToggleRow
            label="Share anonymous usage data"
            sublabel="Helps improve Fame. Never your identity, and never which posts you swipe."
            value={shareUsage}
            onValueChange={toggleUsage}
          />
        </Group>

        <Group title="Discovery">
          <ThemedText type="small" themeColor="textSecondary" style={styles.rowPad}>
            Search radius
          </ThemedText>
          <View style={styles.radii}>
            {RADII.map((m) => (
              <Pressable
                key={m}
                onPress={() => changeRadius(m)}
                accessibilityRole="button"
                style={[
                  styles.radius,
                  {
                    borderColor: radius === m ? BRAND.accent : theme.border,
                    backgroundColor: radius === m ? BRAND.accent : 'transparent',
                  },
                ]}>
                <ThemedText
                  type="small"
                  style={{ color: radius === m ? BRAND.onAccent : theme.text, fontWeight: '600' }}>
                  {m} mi
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </Group>

        <Group title="Notifications">
          {prefs === null ? (
            <View style={styles.rowPad}>
              <ActivityIndicator color={theme.textSecondary} />
            </View>
          ) : (
            <>
              <ToggleRow
                label="New followers"
                value={prefs.follows}
                onValueChange={(v) => togglePref('follows', v)}
              />
              <ToggleRow
                label="Follow requests"
                value={prefs.requests}
                onValueChange={(v) => togglePref('requests', v)}
              />
              <ToggleRow
                label="Comments & replies"
                value={prefs.comments}
                onValueChange={(v) => togglePref('comments', v)}
              />
              <ToggleRow
                label="Comment reactions"
                value={prefs.reactions}
                onValueChange={(v) => togglePref('reactions', v)}
              />
              <ToggleRow
                label="Reach milestones"
                value={prefs.reach}
                onValueChange={(v) => togglePref('reach', v)}
              />
              <ToggleRow
                label="Messages"
                value={prefs.messages}
                onValueChange={(v) => togglePref('messages', v)}
              />
            </>
          )}
        </Group>

        <Group title="Help">
          <LinkRow
            icon="sparkles-outline"
            label="How points work"
            onPress={() => router.push('/points')}
          />
          <LinkRow
            icon="play-circle-outline"
            label="Replay tutorial"
            onPress={() => router.push('/tutorial')}
          />
        </Group>

        <Group title="Safety">
          <LinkRow
            icon="ban-outline"
            label="Blocked & muted"
            onPress={() => router.push('/settings/blocked')}
          />
        </Group>

        <Group title="Account">
          <LinkRow
            icon="key-outline"
            label="Change password"
            onPress={() => router.push('/settings/password')}
          />
          <LinkRow
            icon="download-outline"
            label="Export my data"
            onPress={onExport}
            busy={busy === 'export'}
          />
          <LinkRow icon="log-out-outline" label="Sign out" onPress={() => signOut()} />
          <LinkRow
            icon="trash-outline"
            label="Delete account"
            destructive
            onPress={confirmDelete}
            busy={busy === 'delete'}
          />
        </Group>
      </ScrollView>
    </ThemedView>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.group}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.groupTitle}>
        {title.toUpperCase()}
      </ThemedText>
      <View style={[styles.card, { borderColor: theme.border }]}>{children}</View>
    </View>
  );
}

function ToggleRow({
  label,
  sublabel,
  value,
  onValueChange,
}: {
  label: string;
  sublabel?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <ThemedText type="default">{label}</ThemedText>
        {sublabel ? (
          <ThemedText type="small" themeColor="textSecondary">
            {sublabel}
          </ThemedText>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: BRAND.accent }} />
    </View>
  );
}

function LinkRow({
  icon,
  label,
  onPress,
  destructive,
  busy,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  busy?: boolean;
}) {
  const theme = useTheme();
  const color = destructive ? theme.danger : theme.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={color} />
      <ThemedText type="default" style={[styles.linkLabel, { color }]}>
        {label}
      </ThemedText>
      {busy ? (
        <ActivityIndicator color={theme.textSecondary} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, gap: 22 },
  group: { gap: 8 },
  groupTitle: { paddingHorizontal: 4, letterSpacing: 0.5 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowPad: { padding: 14 },
  rowText: { flex: 1, gap: 2 },
  pressed: { opacity: 0.6 },
  linkLabel: { flex: 1 },
  radii: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 14, paddingTop: 0 },
  radius: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
});

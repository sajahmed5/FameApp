import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ReportFab } from '@/components/report-issue';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { submitAppeal } from '@/lib/profile';

const LABELS: Record<string, string> = {
  post: 'this post',
  comment: 'this comment',
  account: 'your account',
};

/**
 * Appeal form. Reached from a moderation notification (carries target_type + target_id).
 * Writes to the appeals table via submit_appeal, which validates the content is actually
 * the user's and actually actioned.
 */
export default function AppealScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuth();
  const { targetType, targetId, reason: modReason } = useLocalSearchParams<{
    targetType: string;
    targetId?: string;
    reason?: string;
  }>();

  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const kind = (targetType === 'post' || targetType === 'comment' || targetType === 'account'
    ? targetType
    : 'post') as 'post' | 'comment' | 'account';
  // Account appeals are about the caller's own account, so the target is their own id.
  const resolvedTargetId = kind === 'account' ? (targetId ?? user?.id ?? '') : (targetId ?? '');

  const submit = async () => {
    if (reason.trim().length < 3 || !resolvedTargetId) return;
    setBusy(true);
    try {
      await submitAppeal(kind, resolvedTargetId, reason.trim());
      Alert.alert('Appeal submitted', 'Our team will review it and let you know the outcome.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      setBusy(false);
      const msg = e instanceof Error && e.message.includes('already under review')
        ? 'You already have an appeal under review for this.'
        : 'Could not submit your appeal. Try again.';
      Alert.alert('Something went wrong', msg);
    }
  };

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: 'Appeal' }} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">Appeal the decision on {LABELS[kind]}</ThemedText>
          {modReason ? (
            <View style={[styles.reasonBox, { borderColor: theme.border }]}>
              <ThemedText type="small" themeColor="textSecondary">
                Reason given: {modReason}
              </ThemedText>
            </View>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            Tell us why you think this was a mistake. A moderator will review it.
          </ThemedText>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Explain why this should be reconsidered…"
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            maxLength={1000}
          />
          {reason.length >= 900 ? (
            <ThemedText type="small" themeColor={reason.length >= 1000 ? 'danger' : 'textSecondary'} style={styles.counter}>
              {1000 - reason.length} characters left
            </ThemedText>
          ) : null}
          <Button title="Submit appeal" onPress={submit} loading={busy} disabled={reason.trim().length < 3} />
        </ScrollView>
      </KeyboardAvoidingView>
      {/* This route is presented as a modal, which iOS puts in its own container —
          the app-wide button can't reach it. */}
      <ReportFab />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 20, gap: 14 },
  reasonBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, minHeight: 140, textAlignVertical: 'top', fontSize: 16 },
  counter: { textAlign: 'right' },
});

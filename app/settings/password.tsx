import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { changePassword } from '@/lib/profile';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    if (pw.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (pw !== confirm) {
      setError('Passwords don’t match.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await changePassword(pw);
      Alert.alert('Password changed', 'Your password has been updated.');
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change password.');
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: 'Change password' }} />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextField
            label="New password"
            value={pw}
            onChangeText={setPw}
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
            placeholder="At least 8 characters"
          />
          <TextField
            label="Confirm new password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
            placeholder="Re-enter password"
          />
          {error ? <FormMessage tone="error">{error}</FormMessage> : null}
          <Button title="Update password" onPress={save} loading={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 20, gap: 16 },
});

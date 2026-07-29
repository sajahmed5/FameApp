import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { useCooldown } from '@/lib/use-cooldown';

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Non-blocking nudge shown to a signed-in user whose email isn't confirmed yet
 * (possible when Supabase email confirmation is off). Renders nothing once verified.
 */
export function VerifyEmailBanner() {
  const theme = useTheme();
  const { emailVerified, user, resendVerification } = useAuth();
  const cooldown = useCooldown();
  const [note, setNote] = useState<string | null>(null);

  const email = user?.email;
  if (emailVerified || !email) return null;

  const onResend = async () => {
    if (cooldown.active) return;
    setNote(null);
    const { error } = await resendVerification(email);
    cooldown.start(RESEND_COOLDOWN_SECONDS);
    setNote(error ? "Couldn't send — try again in a bit." : 'Sent. Check your inbox (and spam).');
  };

  return (
    <View style={[styles.card, { borderColor: BRAND.accent, backgroundColor: theme.backgroundElement }]}>
      <Ionicons name="mail-unread-outline" size={20} color={BRAND.accent} />
      <View style={styles.text}>
        <ThemedText type="smallBold">Verify your email</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {note ?? `Confirm ${email} to secure your account and keep it recoverable.`}
        </ThemedText>
      </View>
      <Pressable
        onPress={onResend}
        disabled={cooldown.active}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Resend verification email">
        <ThemedText
          type="smallBold"
          style={{ color: cooldown.active ? theme.textSecondary : BRAND.accent }}>
          {cooldown.active ? `${cooldown.remaining}s` : 'Resend'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  text: { flex: 1, gap: 2 },
});

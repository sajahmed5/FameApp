import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';

export default function ProfileScreen() {
  const { profile, user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    await signOut();
    // The root guard routes back to (auth) once the session clears.
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">{profile?.display_name ?? 'Profile'}</ThemedText>
        {profile ? (
          <ThemedText type="default" themeColor="textSecondary">
            @{profile.handle}
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.meta}>
        <Row label="Email" value={user?.email ?? '—'} />
        <Row label="Account" value={profile ? (profile.is_private ? 'Private' : 'Public') : '—'} />
        <Row label="Age band" value={profile?.age_band ?? '—'} />
        <Row label="Points" value={profile ? String(profile.points_balance) : '—'} />
      </View>

      <Button title="Sign out" variant="secondary" onPress={onSignOut} loading={signingOut} />
    </ThemedView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 28,
    justifyContent: 'center',
  },
  header: { gap: 4, alignItems: 'flex-start' },
  meta: { gap: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

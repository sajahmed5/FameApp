import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/hooks/use-theme';

type PublicProfile = {
  id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
};

/**
 * Minimal public profile — enough to satisfy "tapping a handle opens that user's
 * profile". The full profile (posts grid, counts, follow, analytics) is a separate task.
 */
export default function PublicProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, handle, display_name, bio, avatar_url, created_at')
        .eq('handle', handle)
        .maybeSingle();
      if (!active) return;
      if (error) setStatus('error');
      else if (!data) setStatus('missing');
      else {
        setProfile(data as PublicProfile);
        setStatus('ready');
      }
    })();
    return () => {
      active = false;
    };
  }, [handle]);

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </Pressable>
        <ThemedText type="smallBold">@{handle}</ThemedText>
        <View style={{ width: 26 }} />
      </View>

      {status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : status === 'ready' && profile ? (
        <View style={styles.body}>
          {profile.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View
              style={[
                styles.avatar,
                styles.avatarFallback,
                { backgroundColor: theme.backgroundSelected },
              ]}>
              <ThemedText type="title">{profile.display_name.slice(0, 1).toUpperCase()}</ThemedText>
            </View>
          )}
          <ThemedText type="subtitle">{profile.display_name}</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            @{profile.handle}
          </ThemedText>
          {profile.bio ? (
            <ThemedText type="default" style={styles.bio}>
              {profile.bio}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            Joined{' '}
            {new Date(profile.created_at).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric',
            })}
          </ThemedText>
        </View>
      ) : (
        <View style={styles.center}>
          <ThemedText type="default" themeColor="textSecondary">
            {status === 'missing' ? 'This account isn’t available.' : 'Something went wrong.'}
          </ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  body: { alignItems: 'center', gap: 8, padding: 24 },
  avatar: { width: 96, height: 96, borderRadius: 48, marginBottom: 8 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  bio: { textAlign: 'center', maxWidth: 320 },
});

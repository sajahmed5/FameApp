import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { updateOwnProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

const BIO_MAX = 160;
const NAME_MAX = 40;

export default function EditProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile, user, reload } = useAuth();

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [avatarUri, setAvatarUri] = useState<string | null>(profile?.avatar_url ?? null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (res.canceled || !res.assets?.length) return;
    setAvatarUri(res.assets[0].uri);
    setAvatarChanged(true);
  }

  async function uploadAvatar(uri: string): Promise<string> {
    // Downscale to a square-ish 512 then upload to the public avatars bucket.
    const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
    ctx.resize({ width: 512 });
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
    const bytes = await (await fetch(out.uri)).arrayBuffer();
    const path = `${user!.id}/avatar_${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (upErr) throw upErr;
    return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  }

  async function save() {
    if (saving) return;
    const name = displayName.trim();
    if (!name) {
      setError('Display name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const patch: { display_name: string; bio: string; avatar_url?: string } = {
        display_name: name,
        bio: bio.trim(),
      };
      if (avatarChanged && avatarUri) patch.avatar_url = await uploadAvatar(avatarUri);
      await updateOwnProfile(patch);
      reload();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save changes.');
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: 'Edit profile' }} />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={pickAvatar}
            style={styles.avatarWrap}
            accessibilityRole="button"
            accessibilityLabel="Change avatar">
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View
                style={[
                  styles.avatar,
                  styles.avatarFallback,
                  { backgroundColor: theme.backgroundSelected },
                ]}>
                <ThemedText type="title">
                  {(displayName || '?').slice(0, 1).toUpperCase()}
                </ThemedText>
              </View>
            )}
            <View style={styles.avatarBadge}>
              <Ionicons name="camera" size={16} color="#fff" />
            </View>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            Tap to change photo
          </ThemedText>

          <TextField
            label="Display name"
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={NAME_MAX}
          />
          <View>
            <TextField
              label="Bio"
              value={bio}
              onChangeText={setBio}
              maxLength={BIO_MAX}
              multiline
              style={styles.bio}
              placeholder="Tell people about yourself"
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
              {bio.length}/{BIO_MAX}
            </ThemedText>
          </View>

          <View style={[styles.readonly, { borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="textSecondary">
              Handle @{profile?.handle} and date of birth can&apos;t be changed.
            </ThemedText>
          </View>

          {error ? <FormMessage tone="error">{error}</FormMessage> : null}
          <Button title="Save" onPress={save} loading={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 20, gap: 16 },
  avatarWrap: { alignSelf: 'center' },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#000',
    borderRadius: 999,
    padding: 6,
  },
  center: { textAlign: 'center' },
  bio: { minHeight: 72, textAlignVertical: 'top' },
  counter: { alignSelf: 'flex-end', marginTop: 4 },
  readonly: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12 },
});

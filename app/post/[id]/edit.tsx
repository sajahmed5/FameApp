import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TagPicker, type SelectedTag } from '@/components/compose/tag-picker';
import { ReportFab } from '@/components/report-issue';
import { PostAnalyticsCard } from '@/components/profile/post-analytics-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { getPostForEdit, updatePost, type EditablePost } from '@/lib/posts';

const CAPTION_MAX = 2200;
const ALT_MAX = 1000;

export default function EditPostScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [post, setPost] = useState<EditablePost | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [caption, setCaption] = useState('');
  const [altText, setAltText] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [tags, setTags] = useState<SelectedTag[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadError(false);
    try {
      const p = await getPostForEdit(id);
      setPost(p);
      setCaption(p.caption);
      setAltText(p.alt_text);
      setVisibility(p.visibility);
      setTags(p.tags);
    } catch {
      setLoadError(true);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save() {
    if (!id || tags.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updatePost(id, { caption, altText, visibility, tags });
      router.back();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save changes.');
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <ThemedView style={styles.center}>
        <FormMessage tone="error">Couldn&apos;t load this post.</FormMessage>
        <Button title="Retry" variant="secondary" onPress={load} />
      </ThemedView>
    );
  }
  if (!post) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator color={BRAND.accent} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.fill}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
          keyboardShouldPersistTaps="handled">
          <Image source={{ uri: post.media_url }} style={styles.preview} contentFit="cover" />
          <ThemedText type="small" themeColor="textSecondary">
            The media can&apos;t be changed — edit the details below.
          </ThemedText>

          <PostAnalyticsCard postId={id} />

          <View>
            <TextField
              label="Caption"
              placeholder="Write a caption…"
              multiline
              value={caption}
              maxLength={CAPTION_MAX}
              onChangeText={setCaption}
              style={styles.multiline}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
              {caption.length}/{CAPTION_MAX}
            </ThemedText>
          </View>

          <View>
            <TextField
              label="Alt text (optional)"
              placeholder="Describe the media for screen readers"
              multiline
              value={altText}
              maxLength={ALT_MAX}
              onChangeText={setAltText}
              style={styles.multiline}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
              {altText.length}/{ALT_MAX}
            </ThemedText>
          </View>

          <View style={[styles.toggleRow, { borderColor: theme.border }]}>
            <View style={styles.toggleText}>
              <ThemedText type="smallBold">Private post</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Only your accepted followers can see it. Changes take effect immediately.
              </ThemedText>
            </View>
            <Switch
              value={visibility === 'private'}
              onValueChange={(v) => setVisibility(v ? 'private' : 'public')}
              trackColor={{ true: BRAND.accent }}
            />
          </View>

          <TagPicker
            analysing={false}
            visionSuggestions={[]}
            geoSuggestions={[]}
            selected={tags}
            onChange={setTags}
          />

          {saveError ? <FormMessage tone="error">{saveError}</FormMessage> : null}
        </ScrollView>

        <View
          style={[
            styles.saveBar,
            {
              paddingBottom: insets.bottom + 12,
              borderTopColor: theme.border,
              backgroundColor: theme.background,
            },
          ]}>
          <Button
            title="Save changes"
            onPress={save}
            loading={saving}
            disabled={tags.length === 0}
          />
        </View>
      </KeyboardAvoidingView>
      {/* This route is presented as a modal, which iOS puts in its own container —
          the app-wide button can't reach it. */}
      <ReportFab />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  content: { padding: 16, gap: 18 },
  preview: { width: '100%', aspectRatio: 4 / 5, borderRadius: 16, backgroundColor: '#000' },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  counter: { alignSelf: 'flex-end', marginTop: 4 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  toggleText: { flex: 1, gap: 2 },
  saveBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

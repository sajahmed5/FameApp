import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TagPicker } from '@/components/compose/tag-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { TextField } from '@/components/ui/text-field';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { useUpload } from '@/lib/upload-manager';

const CAPTION_MAX = 2200;
const ALT_MAX = 1000;

export default function ComposeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { composition, updateDraft, submit, retryUpload, clear } = useUpload();

  // If there's no active composition (e.g. deep-linked), bounce back.
  useEffect(() => {
    if (!composition) router.back();
  }, [composition, router]);
  // Once posted, leave for Home; the app-wide banner reports completion.
  useEffect(() => {
    if (composition?.postedId) router.replace('/');
  }, [composition?.postedId, router]);

  if (!composition) return <ThemedView style={styles.fill} />;

  const { media, draft, phase, progress, result, rejection, uploadError } = composition;
  const analysing = phase === 'uploading';
  const flagged = result?.moderation_status === 'flagged';
  const canPost = draft.tags.length > 0 && phase !== 'rejected' && !composition.posting;

  function onPost() {
    if (!canPost) return;
    submit();
    // Uploading or ready, posting continues in the background → go to the feed.
    router.replace('/');
  }

  function retake() {
    clear();
    router.back();
  }

  return (
    <ThemedView style={styles.fill}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
          keyboardShouldPersistTaps="handled">
          {/* Preview */}
          <View style={styles.previewWrap}>
            {media.type === 'video' ? (
              <VideoPreview uri={media.uri} />
            ) : (
              <Image source={{ uri: media.uri }} style={styles.preview} contentFit="cover" />
            )}
            <Pressable style={styles.retake} onPress={retake} accessibilityRole="button">
              <Ionicons name="refresh" size={16} color="#fff" />
              <ThemedText type="small" style={styles.retakeText}>
                {media.type === 'video' ? 'Reshoot' : 'Retake'}
              </ThemedText>
            </Pressable>
          </View>

          {/* Upload progress / status */}
          <UploadStatus
            phase={phase}
            progress={progress}
            uploadError={uploadError}
            onRetry={retryUpload}
            flagged={flagged}
          />

          {rejection ? <FormMessage tone="error">{rejection}</FormMessage> : null}

          {/* Caption */}
          <View>
            <TextField
              label="Caption"
              placeholder="Write a caption…"
              multiline
              value={draft.caption}
              maxLength={CAPTION_MAX}
              onChangeText={(t) => updateDraft({ caption: t })}
              style={styles.multiline}
            />
            <Counter value={draft.caption.length} max={CAPTION_MAX} />
          </View>

          {/* Alt text — optional but visible, not hidden in an advanced section */}
          <View>
            <TextField
              label="Alt text (optional)"
              placeholder="Describe the media for people using screen readers"
              multiline
              value={draft.altText}
              maxLength={ALT_MAX}
              onChangeText={(t) => updateDraft({ altText: t })}
              style={styles.multiline}
            />
            <Counter value={draft.altText.length} max={ALT_MAX} />
          </View>

          {/* Visibility */}
          <ToggleRow
            title="Private post"
            subtitle="Only your accepted followers can see it."
            value={draft.visibility === 'private'}
            onValueChange={(v) => updateDraft({ visibility: v ? 'private' : 'public' })}
          />

          {/* Location — off by default, plain explanation */}
          <ToggleRow
            title="Add location"
            subtitle="Shares only an approximate area, never your exact position."
            value={draft.attachLocation}
            onValueChange={(v) => updateDraft({ attachLocation: v })}
            disabled={!result?.suggestions.location_cell}
            disabledNote={
              result && !result.suggestions.location_cell
                ? 'No location found in this media.'
                : undefined
            }
          />

          {/* Tags */}
          <TagPicker
            analysing={analysing}
            visionSuggestions={(result?.suggestions.labels ?? []).map((l) => l.name)}
            geoSuggestions={(result?.suggestions.places ?? []).map((p) => p.name)}
            selected={draft.tags}
            onChange={(tags) => updateDraft({ tags })}
          />
        </ScrollView>

        {/* Post bar */}
        <View
          style={[
            styles.postBar,
            {
              paddingBottom: insets.bottom + 12,
              borderTopColor: theme.border,
              backgroundColor: theme.background,
            },
          ]}>
          <Button
            title={phase === 'uploading' ? 'Post when ready' : 'Post'}
            onPress={onPost}
            disabled={!canPost}
            loading={composition.posting}
          />
          {flagged ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              This post will be reviewed before it appears to others.
            </ThemedText>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

function UploadStatus({
  phase,
  progress,
  uploadError,
  onRetry,
  flagged,
}: {
  phase: string;
  progress: number;
  uploadError: string | null;
  onRetry: () => void;
  flagged: boolean;
}) {
  const theme = useTheme();
  if (phase === 'failed') {
    return (
      <View style={styles.statusRow}>
        <FormMessage tone="error">{uploadError ?? 'Upload failed.'}</FormMessage>
        <Button title="Retry upload" variant="secondary" onPress={onRetry} />
      </View>
    );
  }
  if (phase === 'uploading') {
    return (
      <View style={styles.uploadWrap}>
        <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round(progress * 100)}%`, backgroundColor: BRAND.accent },
            ]}
          />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          Uploading… {Math.round(progress * 100)}%
        </ThemedText>
      </View>
    );
  }
  if (phase === 'ready') {
    return (
      <View style={styles.statusRow}>
        <Ionicons
          name="checkmark-circle"
          size={18}
          color={flagged ? theme.textSecondary : '#2E7D46'}
        />
        <ThemedText type="small" themeColor="textSecondary">
          {flagged
            ? 'Uploaded — will be reviewed before others see it.'
            : 'Uploaded and ready to post.'}
        </ThemedText>
      </View>
    );
  }
  return null;
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <ThemedText
      type="small"
      themeColor={value > max * 0.95 ? 'danger' : 'textSecondary'}
      style={styles.counter}>
      {value}/{max}
    </ThemedText>
  );
}

function ToggleRow({
  title,
  subtitle,
  value,
  onValueChange,
  disabled,
  disabledNote,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  disabledNote?: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.toggleRow, { borderColor: theme.border }]}>
      <View style={styles.toggleText}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {disabled && disabledNote ? disabledNote : subtitle}
        </ThemedText>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: BRAND.accent }}
      />
    </View>
  );
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <VideoView player={player} style={styles.preview} contentFit="cover" nativeControls={false} />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, gap: 18 },
  previewWrap: { borderRadius: 16, overflow: 'hidden' },
  preview: { width: '100%', aspectRatio: 4 / 5, backgroundColor: '#000' },
  retake: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  retakeText: { color: '#fff' },
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
  uploadWrap: { gap: 6 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  postBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  center: { textAlign: 'center' },
});

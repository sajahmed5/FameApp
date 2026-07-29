import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CardMedia } from '@/components/deck/card-media';
import type { DeckCard } from '@/lib/deck';
import { formatCount } from '@/lib/format';

/**
 * Presentational card: full-bleed media + overlays. Used for both the interactive top
 * card and the card beneath, so it stays free of gesture/animation concerns. All tap
 * targets are wired only when `isActive` (the top card) — the beneath-card is inert.
 */
export const SwipeCard = memo(function SwipeCard({
  card,
  isActive,
  onOpenComments,
  onLike,
  onSkip,
  onOpenProfile,
  onOpenTag,
  canUndo,
  onUndo,
}: {
  card: DeckCard;
  isActive: boolean;
  onOpenComments?: () => void;
  onLike?: () => void;
  onSkip?: () => void;
  onOpenProfile?: (handle: string) => void;
  onOpenTag?: (tag: string) => void;
  canUndo?: boolean;
  onUndo?: () => void;
}) {
  return (
    <View style={styles.card}>
      <CardMedia card={card} isActive={isActive} />

      {/* Top-right: like / skip / comment. Tapping the heart likes, the cross skips —
          same commit path as a swipe (handled by the parent via onLike/onSkip). */}
      <View style={styles.topRight}>
        <ActionStat
          icon="heart"
          value={card.like_count}
          onPress={onLike}
          label="Like this post"
        />
        <ActionStat
          icon="close"
          value={card.skip_count}
          onPress={onSkip}
          label="Skip this post"
        />
        <Pressable
          onPress={onOpenComments}
          disabled={!onOpenComments}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open comments"
          style={({ pressed }) => [styles.commentButton, pressed && { opacity: 0.6 }]}>
          <Ionicons name="chatbubble-outline" size={20} color="#fff" />
          <ThemedText type="small" style={styles.statText}>
            {formatCount(card.comment_count)}
          </ThemedText>
        </Pressable>
        {onUndo ? (
          <Pressable
            onPress={onUndo}
            disabled={!canUndo}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Undo last swipe"
            accessibilityState={{ disabled: !canUndo }}
            style={({ pressed }) => [
              styles.actionButton,
              { opacity: canUndo ? (pressed ? 0.6 : 1) : 0.35 },
            ]}>
            <Ionicons name="arrow-undo" size={20} color="#fff" />
          </Pressable>
        ) : null}
      </View>

      {/* Bottom scrim + poster identity + caption + tags. `box-none` so the scrim area
          itself passes touches through to the media (double-tap to like), while its
          interactive children (avatar, handle, tags) still receive their taps. */}
      <View style={styles.bottomScrim} pointerEvents="box-none">
        <Pressable
          onPress={isActive && onOpenProfile ? () => onOpenProfile(card.poster_handle) : undefined}
          disabled={!isActive || !onOpenProfile}
          accessibilityRole="button"
          accessibilityLabel={`Open @${card.poster_handle}'s profile`}
          style={({ pressed }) => [styles.posterRow, pressed && { opacity: 0.7 }]}>
          {card.poster_avatar_url ? (
            <Image
              source={{ uri: card.poster_avatar_url }}
              style={styles.avatar}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <ThemedText type="small" style={styles.avatarInitial}>
                {card.poster_display_name.slice(0, 1).toUpperCase()}
              </ThemedText>
            </View>
          )}
          <View style={styles.posterText}>
            <ThemedText type="smallBold" style={styles.onMedia} numberOfLines={1}>
              {card.poster_display_name}
            </ThemedText>
            <ThemedText type="small" style={styles.onMediaDim} numberOfLines={1}>
              @{card.poster_handle}
            </ThemedText>
          </View>
        </Pressable>

        {card.caption ? (
          <ThemedText type="default" style={styles.onMedia} numberOfLines={3}>
            {card.caption}
          </ThemedText>
        ) : null}

        {card.tags.length > 0 ? (
          <View style={styles.tagRow} pointerEvents="box-none">
            {card.tags.map((t) => (
              <Pressable
                key={t}
                onPress={isActive && onOpenTag ? () => onOpenTag(t) : undefined}
                disabled={!isActive || !onOpenTag}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Search the ${t} tag`}
                style={({ pressed }) => pressed && { opacity: 0.6 }}>
                <ThemedText type="small" style={styles.tag}>
                  #{t}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
});

function ActionStat({
  icon,
  value,
  onPress,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  onPress?: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.stat, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={20} color="#fff" />
      <ThemedText type="small" style={styles.statText}>
        {formatCount(value)}
      </ThemedText>
    </Pressable>
  );
}

// Cross-platform text shadow for legibility over media (web wants the shorthand).
const textShadow = Platform.select({
  web: { textShadow: '0px 1px 3px rgba(0,0,0,0.6)' },
  default: {
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
}) as object;

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  topRight: {
    position: 'absolute',
    top: 16,
    right: 12,
    gap: 14,
    alignItems: 'center',
  },
  stat: { alignItems: 'center', gap: 2 },
  commentButton: { alignItems: 'center', gap: 2, marginTop: 4 },
  actionButton: { alignItems: 'center', marginTop: 4 },
  statText: { color: '#fff', fontWeight: '700', ...textShadow },
  bottomScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 18,
    paddingTop: 40,
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  posterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontWeight: '700' },
  posterText: { flex: 1 },
  onMedia: { color: '#fff', ...textShadow },
  onMediaDim: { color: 'rgba(255,255,255,0.85)' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 4 },
  tag: { color: '#cfe0ff' },
});

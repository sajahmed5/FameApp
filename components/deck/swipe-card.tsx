import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CardMedia } from '@/components/deck/card-media';
import type { DeckCard } from '@/lib/deck';

/**
 * Presentational card: full-bleed media + overlays. Used for both the interactive top
 * card and the card beneath, so it stays free of gesture/animation concerns.
 */
export const SwipeCard = memo(function SwipeCard({
  card,
  isActive,
  onOpenComments,
}: {
  card: DeckCard;
  isActive: boolean;
  onOpenComments?: () => void;
}) {
  return (
    <View style={styles.card}>
      <CardMedia card={card} isActive={isActive} />

      {/* Top-right: like/skip counts + (inert) comment button. */}
      <View style={styles.topRight}>
        <Stat icon="heart" value={card.like_count} />
        <Stat icon="close" value={card.skip_count} />
        <Pressable
          onPress={onOpenComments}
          disabled={!onOpenComments}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open comments"
          style={({ pressed }) => [styles.commentButton, pressed && { opacity: 0.6 }]}>
          <Ionicons name="chatbubble-outline" size={20} color="#fff" />
          <ThemedText type="small" style={styles.statText}>
            {card.comment_count}
          </ThemedText>
        </Pressable>
      </View>

      {/* Bottom scrim + poster identity + caption. */}
      <View style={styles.bottomScrim}>
        <View style={styles.posterRow}>
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
        </View>

        {card.caption ? (
          <ThemedText type="default" style={styles.onMedia} numberOfLines={3}>
            {card.caption}
          </ThemedText>
        ) : null}

        {card.tags.length > 0 ? (
          <ThemedText type="small" style={styles.tags} numberOfLines={1}>
            {card.tags.map((t) => `#${t}`).join('  ')}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
});

function Stat({ icon, value }: { icon: keyof typeof Ionicons.glyphMap; value: number }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={20} color="#fff" />
      <ThemedText type="small" style={styles.statText}>
        {value}
      </ThemedText>
    </View>
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
    pointerEvents: 'none',
  },
  posterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontWeight: '700' },
  posterText: { flex: 1 },
  onMedia: { color: '#fff', ...textShadow },
  onMediaDim: { color: 'rgba(255,255,255,0.85)' },
  tags: { color: '#cfe0ff' },
});

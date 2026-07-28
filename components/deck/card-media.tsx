/* eslint-disable react-hooks/immutability -- expo-video's player is a mutable controller
   object by design (player.muted / play() / currentTime); the rule's "don't mutate hook
   returns" heuristic doesn't model it. */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { DeckCard } from '@/lib/deck';

const VIDEO_CAP_SECONDS = 60;

/** Full-bleed media for a card. Video plays only while the card is focused (the top card). */
export function CardMedia({ card, isActive }: { card: DeckCard; isActive: boolean }) {
  if (card.media_type === 'video') {
    return <CardVideo card={card} isActive={isActive} />;
  }
  return <CardImage card={card} />;
}

function CardImage({ card }: { card: DeckCard }) {
  return (
    <Image
      source={{ uri: card.media_url }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={180}
      recyclingKey={card.id}
    />
  );
}

function CardVideo({ card, isActive }: { card: DeckCard; isActive: boolean }) {
  const [muted, setMuted] = useState(true);

  const player = useVideoPlayer(card.media_url, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 1;
  });

  // Only the focused card plays; leaving re-mutes so the next focus starts muted.
  useEffect(() => {
    if (isActive) {
      player.play();
    } else {
      player.pause();
      player.muted = true;
      // Syncing the mute badge to the player when focus leaves (external-system sync).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMuted(true);
    }
  }, [isActive, player]);

  // Enforce the 60s cap: loop back to the start once a clip passes the cap.
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (currentTime >= VIDEO_CAP_SECONDS) player.currentTime = 0;
    });
    return () => sub.remove();
  }, [player]);

  function toggleMute() {
    const next = !muted;
    player.muted = next;
    setMuted(next);
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Poster frame under the video so there's no black flash before it loads. */}
      <Image
        source={{ uri: card.thumbnail_url }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        recyclingKey={card.id}
      />
      {/* pointerEvents="none": VideoView is a native view that otherwise swallows
          touches at the native layer — above the JS overlay — so the like/skip/comment
          controls stopped responding on video cards. Making it transparent to touches
          lets the overlay controls (and the mute button below) receive taps. This is
          the fix for the "controls dead on video cards" bug, not moving the overlay. */}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        pointerEvents="none"
      />
      {/* Mute is now a discrete button rather than a tap-anywhere target, so it no
          longer competes with double-tap-to-like or the card's other tap targets. */}
      <Pressable
        onPress={toggleMute}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
        style={({ pressed }) => [styles.muteBadge, pressed && { opacity: 0.7 }]}>
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={16} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  muteBadge: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    padding: 8,
  },
});

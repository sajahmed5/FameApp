/* eslint-disable react-hooks/immutability -- Reanimated shared values (incl. the shared
   `topProgress` passed to the card beneath) are intentionally mutated from worklets; the
   rule's "don't mutate props" heuristic doesn't model shared values. */
import { useCallback } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { SwipeCard } from '@/components/deck/swipe-card';
import { SwipeStamp } from '@/components/deck/swipe-stamp';
import type { DeckCard, SwipeDirection } from '@/lib/deck';

const VELOCITY_THRESHOLD = 800;
const PROGRESS_DISTANCE = 180; // px of drag that maps the beneath-card to full size
const FLY_MS = 200;

type SwipeDeckProps = {
  cards: DeckCard[];
  onSwipe: (direction: SwipeDirection) => void;
  onShare: (card: DeckCard) => void;
  onOpenComments: (card: DeckCard) => void;
  canUndo: boolean;
  onUndo: () => void;
};

/**
 * Custom deck on Reanimated + Gesture Handler. The top card follows the finger with
 * rotation; releasing past a distance or velocity threshold commits (fly-off), otherwise
 * it springs back. Swipe up opens share and springs back (does not consume the card).
 * All per-frame work is in worklets on the UI thread — no JS-thread work during a drag.
 */
export function SwipeDeck({
  cards,
  onSwipe,
  onShare,
  onOpenComments,
  canUndo,
  onUndo,
}: SwipeDeckProps) {
  const { width, height } = useWindowDimensions();
  // Drag magnitude of the top card (0..1), read by the card beneath to scale up.
  const topProgress = useSharedValue(0);

  const handleSwipe = useCallback(
    (direction: SwipeDirection) => {
      topProgress.value = 0;
      onSwipe(direction);
    },
    [onSwipe, topProgress],
  );

  const visible = cards.slice(0, 2);

  return (
    <View style={styles.container}>
      {visible[1] ? (
        <DeckCardView
          key={visible[1].id}
          card={visible[1]}
          isTop={false}
          topProgress={topProgress}
          width={width}
          height={height}
          onSwipe={handleSwipe}
          onShare={onShare}
          onOpenComments={onOpenComments}
          canUndo={canUndo}
          onUndo={onUndo}
        />
      ) : null}
      {visible[0] ? (
        <DeckCardView
          key={visible[0].id}
          card={visible[0]}
          isTop
          topProgress={topProgress}
          width={width}
          height={height}
          onSwipe={handleSwipe}
          onShare={onShare}
          onOpenComments={onOpenComments}
          canUndo={canUndo}
          onUndo={onUndo}
        />
      ) : null}
    </View>
  );
}

type DeckCardViewProps = {
  card: DeckCard;
  isTop: boolean;
  topProgress: SharedValue<number>;
  width: number;
  height: number;
  onSwipe: (direction: SwipeDirection) => void;
  onShare: (card: DeckCard) => void;
  onOpenComments: (card: DeckCard) => void;
  canUndo: boolean;
  onUndo: () => void;
};

function DeckCardView({
  card,
  isTop,
  topProgress,
  width,
  height,
  onSwipe,
  onShare,
  onOpenComments,
  canUndo,
  onUndo,
}: DeckCardViewProps) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  const commitX = width * 0.28;
  const commitY = height * 0.16;

  const pan = Gesture.Pan()
    .enabled(isTop)
    .activeOffsetX([-12, 12])
    .activeOffsetY([-12, 12])
    .onUpdate((e) => {
      x.value = e.translationX;
      y.value = e.translationY;
      topProgress.value = Math.min(
        1,
        (Math.abs(e.translationX) + Math.abs(e.translationY)) / PROGRESS_DISTANCE,
      );
    })
    .onEnd((e) => {
      const up =
        (e.translationY < -commitY || e.velocityY < -VELOCITY_THRESHOLD) &&
        Math.abs(e.translationY) > Math.abs(e.translationX);
      const right = e.translationX > commitX || e.velocityX > VELOCITY_THRESHOLD;
      const left = e.translationX < -commitX || e.velocityX < -VELOCITY_THRESHOLD;

      if (up) {
        // Share: bounce back, don't consume the card.
        x.value = withSpring(0);
        y.value = withSpring(0);
        topProgress.value = withSpring(0);
        runOnJS(onShare)(card);
      } else if (right || left) {
        const direction: SwipeDirection = right ? 'right' : 'left';
        y.value = withTiming(e.translationY + 40, { duration: FLY_MS });
        x.value = withTiming((right ? 1.5 : -1.5) * width, { duration: FLY_MS }, (finished) => {
          if (finished) runOnJS(onSwipe)(direction);
        });
      } else {
        x.value = withSpring(0);
        y.value = withSpring(0);
        topProgress.value = withSpring(0);
      }
    });

  const cardStyle = useAnimatedStyle(() => {
    if (isTop) {
      const rotate = interpolate(x.value, [-width, 0, width], [-10, 0, 10], Extrapolation.CLAMP);
      return {
        transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${rotate}deg` }],
      };
    }
    const scale = interpolate(topProgress.value, [0, 1], [0.94, 1], Extrapolation.CLAMP);
    const translateY = interpolate(topProgress.value, [0, 1], [14, 0], Extrapolation.CLAMP);
    return { transform: [{ scale }, { translateY }] };
  }, [isTop, width]);

  const likeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, commitX], [0, 1], Extrapolation.CLAMP),
  }));
  const skipStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [-commitX, 0], [1, 0], Extrapolation.CLAMP),
  }));
  const shareStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [-commitY, 0], [1, 0], Extrapolation.CLAMP),
  }));

  const content = (
    <Animated.View style={[styles.cardWrap, cardStyle]}>
      <SwipeCard
        card={card}
        isActive={isTop}
        onOpenComments={isTop ? () => onOpenComments(card) : undefined}
        canUndo={isTop ? canUndo : undefined}
        onUndo={isTop ? onUndo : undefined}
      />
      {isTop ? (
        <>
          <Animated.View style={[styles.stamp, styles.stampLeft, likeStyle]}>
            <SwipeStamp label="LIKE" color="#2E7D46" />
          </Animated.View>
          <Animated.View style={[styles.stamp, styles.stampRight, skipStyle]}>
            <SwipeStamp label="SKIP" color="#D64545" />
          </Animated.View>
          <Animated.View style={[styles.stamp, styles.stampTop, shareStyle]}>
            <SwipeStamp label="SHARE" color="#208AEF" />
          </Animated.View>
        </>
      ) : null}
    </Animated.View>
  );

  return isTop ? <GestureDetector gesture={pan}>{content}</GestureDetector> : content;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  cardWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  stamp: { position: 'absolute', top: 40, pointerEvents: 'none' },
  stampLeft: { left: 24, transform: [{ rotate: '-14deg' }] },
  stampRight: { right: 24, transform: [{ rotate: '14deg' }] },
  stampTop: { alignSelf: 'center', top: 80 },
});

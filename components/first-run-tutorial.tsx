import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';

type Direction = 'right' | 'left' | 'up';

type Card =
  | { kind: 'gesture'; direction: Direction; icon: keyof typeof Ionicons.glyphMap; title: string; body: string }
  | { kind: 'points'; title: string; body: string };

const CARDS: Card[] = [
  {
    kind: 'gesture',
    direction: 'right',
    icon: 'heart',
    title: 'Swipe right to like',
    body: 'See something you love? Flick the card right. Liking and skipping are private — no one sees which way you swiped.',
  },
  {
    kind: 'gesture',
    direction: 'left',
    icon: 'close',
    title: 'Swipe left to skip',
    body: "Not for you? Swipe left and the next post slides in. There's always more in the deck.",
  },
  {
    kind: 'gesture',
    direction: 'up',
    icon: 'arrow-redo',
    title: 'Swipe up to share',
    body: 'Send a post to a friend in the app, or out to WhatsApp and anywhere else.',
  },
  {
    kind: 'points',
    title: 'Taking part earns points',
    body: 'Swiping, commenting and sharing all earn points — and the more you earn, the further your own posts travel. Points never expire.',
  },
];

/** Full-screen, paged, skippable first-run tutorial. Owns no persistence — the caller
 *  decides what "done" means (mark the profile, show the camera coach mark, etc.). */
export function FirstRunTutorial({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const last = CARDS.length - 1;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  const goNext = () => {
    if (index >= last) return onDone();
    // Advance index optimistically: on web onMomentumScrollEnd never fires, so we
    // can't rely on the scroll handler to update it after a programmatic scroll.
    const next = index + 1;
    setIndex(next);
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
  };

  return (
    <ThemedView style={styles.fill}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onDone} hitSlop={12} accessibilityRole="button">
          <ThemedText type="small" themeColor="textSecondary">
            Skip
          </ThemedText>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={16}>
        {CARDS.map((card, i) => (
          <View key={i} style={[styles.page, { width }]}>
            {card.kind === 'gesture' ? (
              <GestureDemo direction={card.direction} icon={card.icon} active={i === index} />
            ) : (
              <View style={[styles.pointsBadge, { borderColor: BRAND.accent }]}>
                <Ionicons name="sparkles" size={44} color={BRAND.accent} />
              </View>
            )}
            <ThemedText type="title" style={styles.cardTitle}>
              {card.title}
            </ThemedText>
            <ThemedText type="default" themeColor="textSecondary" style={styles.cardBody}>
              {card.body}
            </ThemedText>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.dots}>
          {CARDS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i === index ? BRAND.accent : theme.border },
              ]}
            />
          ))}
        </View>
        <Button title={index === last ? 'Get started' : 'Next'} onPress={goNext} />
      </View>
    </ThemedView>
  );
}

/** A phone-sized card with a looping arrow animating in the taught direction. */
function GestureDemo({
  direction,
  icon,
  active,
}: {
  direction: Direction;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
}) {
  const theme = useTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      progress.value = 0;
      return;
    }
    // Ease out along the gesture direction, snap back, repeat — a hint, not a full swipe.
    progress.value = withRepeat(
      withSequence(withTiming(1, { duration: 800 }), withTiming(0, { duration: 250 })),
      -1,
      false,
    );
  }, [active, progress]);

  const DIST = 60;
  const dx = direction === 'right' ? DIST : direction === 'left' ? -DIST : 0;
  const dy = direction === 'up' ? -DIST : 0;

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * dx },
      { translateY: progress.value * dy },
      { rotateZ: `${progress.value * (dx / DIST) * 8}deg` },
    ],
    opacity: 1 - progress.value * 0.25,
  }));

  const arrowName =
    direction === 'right'
      ? 'arrow-forward'
      : direction === 'left'
        ? 'arrow-back'
        : 'arrow-up';

  return (
    <View style={styles.demo}>
      <Animated.View
        style={[
          styles.demoCard,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          cardStyle,
        ]}>
        <Ionicons name={icon} size={52} color={BRAND.accent} />
      </Animated.View>
      <View style={[styles.arrowBadge, { backgroundColor: BRAND.accent }]}>
        <Ionicons name={arrowName} size={22} color={BRAND.onAccent} />
      </View>
    </View>
  );
}

const CARD_W = Math.min(Dimensions.get('window').width * 0.5, 200);

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingBottom: 4 },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 18 },
  demo: { alignItems: 'center', justifyContent: 'center', gap: 18, marginBottom: 8 },
  demoCard: {
    width: CARD_W,
    height: CARD_W * 1.3,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pointsBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  cardTitle: { textAlign: 'center' },
  cardBody: { textAlign: 'center', lineHeight: 22 },
  footer: { paddingHorizontal: 24, gap: 18 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

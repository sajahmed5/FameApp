import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import type { OverlayLayer } from '@/components/media-editor/types';
import { BRAND } from '@/constants/config';

const TEXT_BASE = 34;
const STICKER_BASE = 52;

export type Transform = { x: number; y: number; scale: number; rotation: number };

/**
 * A single draggable / pinch-to-scale / rotatable overlay (text or sticker), rendered as
 * a native view on top of the Skia canvas so gestures stay smooth on the UI thread. The
 * transform is committed to history only on gesture end (keeps undo granular and the doc
 * pure). Because it's a real view, `makeImageFromView` burns it into the export.
 */
export function EditableOverlay({
  layer,
  selected,
  onSelect,
  onCommit,
  onDelete,
  onEditText,
}: {
  layer: OverlayLayer;
  selected: boolean;
  onSelect: (id: string) => void;
  onCommit: (id: string, t: Transform) => void;
  onDelete: (id: string) => void;
  onEditText: (id: string) => void;
}) {
  const x = useSharedValue(layer.x);
  const y = useSharedValue(layer.y);
  const scale = useSharedValue(layer.scale);
  const rotation = useSharedValue(layer.rotation);
  // Measured size (JS state, not a shared value): it only changes on layout, and the
  // animated worklet closes over the latest value on re-render.
  const [size, setSize] = useState({ w: 0, h: 0 });

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startRot = useSharedValue(0);

  const commit = () => onCommit(layer.id, { x: x.value, y: y.value, scale: scale.value, rotation: rotation.value });

  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      x.value = startX.value + e.translationX;
      y.value = startY.value + e.translationY;
    })
    .onEnd(() => runOnJS(commit)());

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.max(0.2, Math.min(6, startScale.value * e.scale));
    })
    .onEnd(() => runOnJS(commit)());

  const rotate = Gesture.Rotation()
    .onBegin(() => {
      startRot.value = rotation.value;
    })
    .onUpdate((e) => {
      rotation.value = startRot.value + e.rotation;
    })
    .onEnd(() => runOnJS(commit)());

  const tap = Gesture.Tap().onEnd(() => runOnJS(onSelect)(layer.id));

  // Double-tap re-opens the text editor. The corner pencil badge does the same job, but
  // it's a 24pt target that gets clipped when the layer sits near the canvas edge.
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      runOnJS(onSelect)(layer.id);
      if (layer.kind === 'text') runOnJS(onEditText)(layer.id);
    });

  const gesture = Gesture.Simultaneous(pan, pinch, rotate, Gesture.Exclusive(doubleTap, tap));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value - size.w / 2 },
      { translateY: y.value - size.h / 2 },
      { scale: scale.value },
      { rotate: `${rotation.value}rad` },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.item, selected && styles.selected, animatedStyle]}
        onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {layer.kind === 'text' ? (
          <Text
            style={{
              fontFamily: layer.fontFamily === 'System' ? undefined : layer.fontFamily,
              color: layer.color,
              fontSize: TEXT_BASE,
              fontWeight: '700',
              textShadowColor: 'rgba(0,0,0,0.35)',
              textShadowRadius: 4,
            }}>
            {layer.text}
          </Text>
        ) : (
          <Text style={{ fontSize: STICKER_BASE }}>{layer.emoji}</Text>
        )}

        {selected ? (
          <>
            <Pressable
              style={[styles.badge, styles.badgeDelete]}
              onPress={() => onDelete(layer.id)}
              hitSlop={8}>
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
            {layer.kind === 'text' ? (
              <Pressable
                style={[styles.badge, styles.badgeEdit]}
                onPress={() => onEditText(layer.id)}
                hitSlop={8}>
                <Ionicons name="pencil" size={13} color="#fff" />
              </Pressable>
            ) : null}
          </>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  item: { position: 'absolute', left: 0, top: 0, padding: 6, alignItems: 'center', justifyContent: 'center' },
  selected: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', borderRadius: 8, borderStyle: 'dashed' },
  badge: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDelete: { top: -12, right: -12, backgroundColor: '#FF3B30' },
  badgeEdit: { top: -12, left: -12, backgroundColor: BRAND.accent },
});

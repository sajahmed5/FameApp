import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

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
    .runOnJS(true)
    .onBegin(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      x.value = startX.value + e.translationX;
      y.value = startY.value + e.translationY;
    })
    .onEnd(commit);

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onBegin(() => {
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.max(0.2, Math.min(6, startScale.value * e.scale));
    })
    .onEnd(commit);

  const rotate = Gesture.Rotation()
    .runOnJS(true)
    .onBegin(() => {
      startRot.value = rotation.value;
    })
    .onUpdate((e) => {
      rotation.value = startRot.value + e.rotation;
    })
    .onEnd(commit);

  // EVERY gesture here runs on the JS thread.
  //
  // Two crashes came out of this component in two days, both RCTFatal from inside
  // WorkletRuntime::runSync — an unhandled JS throw on the UI thread, which is a hard
  // abort rather than a caught error. The first was the taps; moving only those left a
  // MIXED composition (taps on JS, pan/pinch/rotate as worklets) inside one
  // Gesture.Simultaneous, and the second crash came from dragging and pinching.
  //
  // These callbacks only mutate shared values and call one React setter on end. Setting
  // a shared value from the JS thread is supported, and useAnimatedStyle still reads it
  // on the UI thread, so the transform itself stays off the JS thread. The cost is a
  // frame of latency on a 34pt overlay; the benefit is that a throw here is catchable
  // rather than fatal.
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => onSelect(layer.id));

  // Double-tap re-opens the text editor. The corner pencil badge does the same job, but
  // it's a 24pt target that gets clipped when the layer sits near the canvas edge.
  const doubleTap = Gesture.Tap()
    .runOnJS(true)
    .numberOfTaps(2)
    .onEnd(() => {
      onSelect(layer.id);
      if (layer.kind === 'text') onEditText(layer.id);
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

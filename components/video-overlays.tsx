import { StyleSheet, Text, View } from 'react-native';

import type { VideoOverlay } from '@/lib/video-overlays';

/**
 * Draws a video post's text/sticker overlays over its player. Purely visual — no
 * gestures, `pointerEvents="none"` — so taps and swipes fall through to whatever the
 * host surface does (deck swipes, feed taps, post view).
 *
 * `width`/`height` are the rendered media box. Positions are normalised (0..1, centre
 * anchored) and `size` is a fraction of the width, so the overlay keeps its place and
 * proportion at any playback size.
 */
export function VideoOverlays({
  overlays,
  width,
  height,
}: {
  overlays: VideoOverlay[];
  width: number;
  height: number;
}) {
  if (!overlays.length || !width || !height) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {overlays.map((o, i) => {
        const fontSize = Math.max(8, o.size * width);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: o.nx * width,
              top: o.ny * height,
              transform: [
                // Centre-anchor without measuring: shift back by half our own size.
                { translateX: '-50%' as unknown as number },
                { translateY: '-50%' as unknown as number },
                { rotate: `${o.rotation}rad` },
              ],
            }}>
            {o.kind === 'text' ? (
              <Text
                style={{
                  fontFamily: o.font === 'System' ? undefined : o.font,
                  color: o.color,
                  fontSize,
                  fontWeight: '700',
                  textShadowColor: 'rgba(0,0,0,0.35)',
                  textShadowRadius: 4,
                }}>
                {o.text}
              </Text>
            ) : (
              <Text style={{ fontSize }}>{o.emoji}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

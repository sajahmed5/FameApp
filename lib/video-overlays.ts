/**
 * Video text/sticker overlays: the normalised form stored on posts.overlays and drawn
 * over the player at playback.
 *
 * A photo's overlays are burned into the exported JPEG, so nothing is stored. Video
 * can't be flattened on-device without re-encoding every frame, so its overlays stay
 * data — which is also why POSITIONS ARE NORMALISED (0..1 of the media, centre-based),
 * never pixels: the editor canvas, the swipe deck, the feed card and the post view are
 * all different sizes.
 *
 * `size` is the glyph size as a fraction of the media WIDTH (fontSize = size * width at
 * playback), so text keeps its proportion of the frame everywhere.
 */
import type { OverlayLayer } from '@/components/media-editor/types';

export type VideoOverlay =
  | { kind: 'text'; text: string; color: string; font: string; nx: number; ny: number; size: number; rotation: number }
  | { kind: 'sticker'; emoji: string; nx: number; ny: number; size: number; rotation: number };

/** Editor glyph bases — must match TEXT_BASE / STICKER_BASE in editable-overlay.tsx. */
const TEXT_BASE = 34;
const STICKER_BASE = 52;

/** Convert editor layers (capture-view px, canvas cw×ch) to the normalised form. */
export function toVideoOverlays(layers: OverlayLayer[], cw: number, ch: number): VideoOverlay[] {
  if (!cw || !ch) return [];
  return layers.map((l) =>
    l.kind === 'text'
      ? {
          kind: 'text' as const,
          text: l.text,
          color: l.color,
          font: l.fontFamily,
          nx: l.x / cw,
          ny: l.y / ch,
          size: (TEXT_BASE * l.scale) / cw,
          rotation: l.rotation,
        }
      : {
          kind: 'sticker' as const,
          emoji: l.emoji,
          nx: l.x / cw,
          ny: l.y / ch,
          size: (STICKER_BASE * l.scale) / cw,
          rotation: l.rotation,
        },
  );
}

/** Parse whatever came out of the jsonb column; anything malformed is dropped. */
export function parseVideoOverlays(raw: unknown): VideoOverlay[] {
  if (!Array.isArray(raw)) return [];
  const ok: VideoOverlay[] = [];
  for (const o of raw as Record<string, unknown>[]) {
    if (!o || typeof o !== 'object') continue;
    const base =
      typeof o.nx === 'number' && typeof o.ny === 'number' &&
      typeof o.size === 'number' && typeof o.rotation === 'number';
    if (!base) continue;
    if (o.kind === 'text' && typeof o.text === 'string' && typeof o.color === 'string') {
      ok.push({
        kind: 'text', text: o.text, color: o.color,
        font: typeof o.font === 'string' ? o.font : 'System',
        nx: o.nx as number, ny: o.ny as number, size: o.size as number, rotation: o.rotation as number,
      });
    } else if (o.kind === 'sticker' && typeof o.emoji === 'string') {
      ok.push({
        kind: 'sticker', emoji: o.emoji,
        nx: o.nx as number, ny: o.ny as number, size: o.size as number, rotation: o.rotation as number,
      });
    }
  }
  return ok.slice(0, 20);
}

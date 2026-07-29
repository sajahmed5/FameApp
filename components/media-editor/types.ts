/**
 * Editor document model. One immutable `EditorDoc` is the single source of truth for the
 * scene; every edit produces a new doc pushed onto the undo/redo history. Coordinates are
 * in the capture-view's pixel space (the same space used for both live rendering and the
 * `makeImageFromView` export), so a layer's transform maps 1:1 into the exported image.
 */
export type TextLayer = {
  id: string;
  kind: 'text';
  text: string;
  color: string;
  fontFamily: string;
  /** centre position + transform, in capture-view px. */
  x: number;
  y: number;
  scale: number;
  rotation: number; // radians
};

export type StickerLayer = {
  id: string;
  kind: 'sticker';
  emoji: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

export type OverlayLayer = TextLayer | StickerLayer;

/** A freehand brush stroke; points are in capture-view px. */
export type Stroke = {
  id: string;
  color: string;
  width: number;
  points: { x: number; y: number }[];
};

export type EditorDoc = {
  filterId: string;
  layers: OverlayLayer[];
  strokes: Stroke[];
};

export const EMPTY_DOC: EditorDoc = { filterId: 'none', layers: [], strokes: [] };

/** Fonts offered for text overlays (system faces available on both platforms). */
export const FONTS: { label: string; family: string }[] = [
  { label: 'Sans', family: 'System' },
  { label: 'Serif', family: 'Georgia' },
  { label: 'Mono', family: 'Courier' },
];

/** Colour palette shared by text and the brush. */
export const PALETTE = [
  '#FFFFFF',
  '#000000',
  '#208AEF',
  '#FF3B30',
  '#FFCC00',
  '#34C759',
  '#AF52DE',
  '#FF9500',
];

/** Brush sizes offered while drawing. */
export const BRUSH_SIZES = [4, 10, 20];

/** Emoji/sticker palette. */
export const STICKERS = ['😀', '😍', '🔥', '💯', '✨', '🎉', '❤️', '👍', '😂', '🥳', '🌟', '📸'];

let seq = 0;
/** Monotonic id for new layers/strokes (no Math.random — deterministic across renders). */
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

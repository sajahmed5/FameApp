import { Ionicons } from '@expo/vector-icons';
import {
  Canvas,
  ColorMatrix,
  Group,
  Image as SkiaImage,
  Path as SkiaPath,
  Skia,
  useImage,
  type SkImage,
} from '@shopify/react-native-skia';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND } from '@/constants/config';

import { EditableOverlay, type Transform } from '@/components/media-editor/editable-overlay';
import { FILTERS, filterById } from '@/components/media-editor/filters';
import {
  BRUSH_SIZES,
  EMPTY_DOC,
  FONTS,
  nextId,
  PALETTE,
  STICKERS,
  type Stroke,
  type TextLayer,
} from '@/components/media-editor/types';
import { useEditorHistory } from '@/components/media-editor/use-editor-history';
import { ReportFab } from '@/components/report-issue';
import { ThemedText } from '@/components/themed-text';
import { exportEditedImage, type ExportedMedia } from '@/lib/media-editor';

type Tool = 'filter' | 'text' | 'sticker' | 'draw';

/** Filter preview tile size; the bordered swatch adds its 2pt border either side. */
const SWATCH = 44;

/**
 * The filter row, memoised. Each swatch is a live Skia canvas, so without this every
 * unrelated state change in the editor — selecting a layer, dragging one, adding a
 * sticker — re-rendered all of them. Only the loaded image and the active filter can
 * change what these look like.
 */
const FilterSwatches = memo(function FilterSwatches({
  image,
  activeId,
  onPick,
}: {
  image: SkImage | null;
  activeId: string;
  onPick: (id: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowPad}>
      {FILTERS.map((f) => (
        <Pressable key={f.id} style={styles.filterChip} onPress={() => onPick(f.id)}>
          {/* Was an empty bordered box, which told you nothing about the filter. */}
          <View style={[styles.filterSwatch, { borderColor: activeId === f.id ? BRAND.accent : '#333' }]}>
            {image ? (
              <Canvas style={styles.filterSwatchCanvas}>
                <SkiaImage image={image} x={0} y={0} width={SWATCH} height={SWATCH} fit="cover">
                  {f.matrix ? <ColorMatrix matrix={f.matrix} /> : null}
                </SkiaImage>
              </Canvas>
            ) : null}
          </View>
          <Text style={[styles.chipLabel, activeId === f.id && styles.chipActive]}>{f.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
});

/** Build a Skia path from captured points (simple polyline; round-capped when stroked). */
function toPath(points: { x: number; y: number }[]) {
  const p = Skia.Path.Make();
  if (points.length > 0) {
    p.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) p.lineTo(points[i].x, points[i].y);
    if (points.length === 1) p.lineTo(points[0].x + 0.1, points[0].y + 0.1); // a dot
  }
  return p;
}

/**
 * Shared image editor for posts and stories. Filters run GPU-side (Skia ColorMatrix);
 * text/stickers are draggable/pinchable native overlays; drawing is Skia paths. Done →
 * flattens everything to a JPEG via makeImageFromView and hands the URI back.
 */
export function MediaEditor({
  uri,
  onDone,
  onCancel,
}: {
  uri: string;
  onDone: (media: ExportedMedia) => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const image = useImage(uri);
  const captureRef = useRef<View>(null);

  const { doc, update, undo, redo, canUndo, canRedo } = useEditorHistory(EMPTY_DOC);
  const [tool, setTool] = useState<Tool>('filter');
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // draw state
  const [brushColor, setBrushColor] = useState(PALETTE[0]);
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[1]);
  const [livePoints, setLivePoints] = useState<{ x: number; y: number }[]>([]);

  // text editor modal state
  const [textDraft, setTextDraft] = useState<{
    id: string | null;
    text: string;
    color: string;
    fontFamily: string;
  } | null>(null);

  // Fit the image into the available area, aspect-correct (no letterbox in the export).
  const topH = insets.top + 52;
  const bottomH = insets.bottom + 132;
  const areaW = winW;
  const areaH = Math.max(200, winH - topH - bottomH);
  const { cw, ch } = useMemo(() => {
    const aspect = image ? image.width() / image.height() : 1;
    if (areaW / areaH > aspect) return { cw: areaH * aspect, ch: areaH };
    return { cw: areaW, ch: areaW / aspect };
  }, [image, areaW, areaH]);

  const filterMatrix = filterById(doc.filterId).matrix;

  // --- edit operations (each commits a new doc) ---
  const setFilter = useCallback((id: string) => update((d) => ({ ...d, filterId: id })), [update]);

  const addSticker = useCallback(
    (emoji: string) =>
      update((d) => ({
        ...d,
        layers: [
          ...d.layers,
          { id: nextId('st'), kind: 'sticker', emoji, x: cw / 2, y: ch / 2, scale: 1, rotation: 0 },
        ],
      })),
    [update, cw, ch],
  );

  const commitTransform = useCallback(
    (id: string, t: Transform) =>
      update((d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === id ? { ...l, ...t } : l)),
      })),
    [update],
  );

  const deleteLayer = useCallback(
    (id: string) => {
      setSelected(null);
      update((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    },
    [update],
  );

  const saveText = useCallback(() => {
    if (!textDraft) return;
    const { id, text, color, fontFamily } = textDraft;
    const trimmed = text.trim();
    setTextDraft(null);
    if (!trimmed) {
      if (id) deleteLayer(id);
      return;
    }
    update((d) => {
      if (id) {
        return {
          ...d,
          layers: d.layers.map((l) =>
            l.id === id && l.kind === 'text' ? { ...l, text: trimmed, color, fontFamily } : l,
          ),
        };
      }
      const layer: TextLayer = {
        id: nextId('tx'),
        kind: 'text',
        text: trimmed,
        color,
        fontFamily,
        x: cw / 2,
        y: ch / 2,
        scale: 1,
        rotation: 0,
      };
      return { ...d, layers: [...d.layers, layer] };
    });
  }, [textDraft, update, deleteLayer, cw, ch]);

  const commitStroke = useCallback(
    (points: { x: number; y: number }[]) => {
      if (points.length === 0) return;
      const stroke: Stroke = { id: nextId('dr'), color: brushColor, width: brushSize, points };
      update((d) => ({ ...d, strokes: [...d.strokes, stroke] }));
    },
    [brushColor, brushSize, update],
  );

  // --- drawing gesture (only mounted in draw mode) ---
  const drawGesture = useMemo(
    () =>
      Gesture.Pan()
        // With Reanimated installed these callbacks are workletized and run on the UI
        // thread, where calling setState directly crashes. Drawing needs React state for
        // the live path, so keep the whole gesture on the JS thread.
        .runOnJS(true)
        .maxPointers(1)
        .onBegin((e) => setLivePoints([{ x: e.x, y: e.y }]))
        .onUpdate((e) => setLivePoints((prev) => [...prev, { x: e.x, y: e.y }]))
        .onEnd(() => {
          setLivePoints((pts) => {
            commitStroke(pts);
            return [];
          });
        }),
    [commitStroke],
  );

  const onDonePress = useCallback(() => {
    setSelected(null);
    setExporting(true);
    // Give React a frame to drop selection chrome before the snapshot.
    setTimeout(async () => {
      try {
        const out = await exportEditedImage(captureRef, nextId('exp'));
        onDone(out);
      } catch {
        setExporting(false);
        Alert.alert('Export failed', 'Could not apply your edits. Try again.');
      }
    }, 60);
  }, [onDone]);

  return (
    <View style={styles.root}>
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={onCancel} hitSlop={10} disabled={exporting}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <View style={styles.topRight}>
          <Pressable onPress={undo} disabled={!canUndo || exporting} hitSlop={8}>
            <Ionicons name="arrow-undo" size={22} color={canUndo ? '#fff' : '#666'} />
          </Pressable>
          <Pressable onPress={redo} disabled={!canRedo || exporting} hitSlop={8}>
            <Ionicons name="arrow-redo" size={22} color={canRedo ? '#fff' : '#666'} />
          </Pressable>
          <Pressable style={styles.doneBtn} onPress={onDonePress} disabled={exporting || !image}>
            {exporting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.doneText}>Done</Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* Canvas area */}
      <View style={styles.canvasArea}>
        {!image ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <View
            ref={captureRef}
            collapsable={false}
            style={{ width: cw, height: ch, overflow: 'hidden' }}>
            <Canvas style={{ width: cw, height: ch }}>
              <Group>
                <SkiaImage image={image} x={0} y={0} width={cw} height={ch} fit="cover">
                  {filterMatrix ? <ColorMatrix matrix={filterMatrix} /> : null}
                </SkiaImage>
                {doc.strokes.map((s) => (
                  <SkiaPath
                    key={s.id}
                    path={toPath(s.points)}
                    color={s.color}
                    style="stroke"
                    strokeWidth={s.width}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                ))}
                {livePoints.length > 0 ? (
                  <SkiaPath
                    path={toPath(livePoints)}
                    color={brushColor}
                    style="stroke"
                    strokeWidth={brushSize}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                ) : null}
              </Group>
            </Canvas>

            {/* Tap empty canvas to deselect. Must sit UNDER the overlays — as a sibling
                painted after them it would swallow their pan/pinch/rotate and badges. */}
            {tool !== 'draw' && selected ? (
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelected(null)} />
            ) : null}

            {/* Text / sticker overlays */}
            {doc.layers.map((l) => (
              <EditableOverlay
                key={l.id}
                layer={l}
                selected={!exporting && selected === l.id}
                onSelect={setSelected}
                onCommit={commitTransform}
                onDelete={deleteLayer}
                onEditText={(id) => {
                  const layer = doc.layers.find((x) => x.id === id);
                  if (layer?.kind === 'text') {
                    setTextDraft({ id, text: layer.text, color: layer.color, fontFamily: layer.fontFamily });
                  }
                }}
              />
            ))}

            {/* Drawing capture layer (on top) only in draw mode */}
            {tool === 'draw' ? (
              <GestureDetector gesture={drawGesture}>
                <View style={StyleSheet.absoluteFill} />
              </GestureDetector>
            ) : null}
          </View>
        )}
      </View>

      {/* Contextual panel */}
      {!exporting ? (
        <View style={[styles.panel, { paddingBottom: insets.bottom + 6 }]}>
          {tool === 'filter' ? (
            <FilterSwatches image={image} activeId={doc.filterId} onPick={setFilter} />
          ) : null}

          {tool === 'sticker' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowPad}>
              {STICKERS.map((e) => (
                <Pressable key={e} style={styles.sticker} onPress={() => addSticker(e)}>
                  <Text style={{ fontSize: 30 }}>{e}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {tool === 'draw' ? (
            <View style={styles.rowPad}>
              <View style={styles.drawRow}>
                {BRUSH_SIZES.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => setBrushSize(s)}
                    style={[styles.brushDotWrap, brushSize === s && styles.brushDotSel]}>
                    <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#fff' }} />
                  </Pressable>
                ))}
                <View style={{ width: 12 }} />
                {PALETTE.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setBrushColor(c)}
                    style={[styles.swatch, { backgroundColor: c }, brushColor === c && styles.swatchSel]}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {tool === 'text' ? (
            <View style={styles.rowPad}>
              <Pressable
                style={styles.addTextBtn}
                onPress={() => setTextDraft({ id: null, text: '', color: PALETTE[0], fontFamily: FONTS[0].family })}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addTextLabel}>Add text</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Tool tabs */}
          <View style={styles.tabs}>
            <ToolTab icon="color-filter-outline" label="Filters" active={tool === 'filter'} onPress={() => setTool('filter')} />
            <ToolTab icon="text-outline" label="Text" active={tool === 'text'} onPress={() => setTool('text')} />
            <ToolTab icon="happy-outline" label="Sticker" active={tool === 'sticker'} onPress={() => setTool('sticker')} />
            <ToolTab icon="brush-outline" label="Draw" active={tool === 'draw'} onPress={() => setTool('draw')} />
          </View>
        </View>
      ) : null}

      {/* Text input modal */}
      {textDraft ? (
        <View style={styles.textModal}>
          <View style={[styles.textModalBar, { paddingTop: insets.top + 8 }]}>
            <Pressable onPress={() => setTextDraft(null)} hitSlop={10}>
              <ThemedText style={{ color: '#fff' }}>Cancel</ThemedText>
            </Pressable>
            <Pressable onPress={saveText} hitSlop={10}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
          <TextInput
            value={textDraft.text}
            onChangeText={(t) => setTextDraft((d) => (d ? { ...d, text: t } : d))}
            placeholder="Type something"
            placeholderTextColor="rgba(255,255,255,0.5)"
            autoFocus
            multiline
            style={[styles.textModalInput, { color: textDraft.color, fontFamily: textDraft.fontFamily === 'System' ? undefined : textDraft.fontFamily }]}
          />
          <View style={styles.textModalControls}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowPad}>
              {FONTS.map((f) => (
                <Pressable
                  key={f.family}
                  onPress={() => setTextDraft((d) => (d ? { ...d, fontFamily: f.family } : d))}
                  style={[styles.fontChip, textDraft.fontFamily === f.family && styles.fontChipSel]}>
                  <Text style={{ color: '#fff', fontFamily: f.family === 'System' ? undefined : f.family }}>{f.label}</Text>
                </Pressable>
              ))}
              <View style={{ width: 12 }} />
              {PALETTE.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setTextDraft((d) => (d ? { ...d, color: c } : d))}
                  style={[styles.swatch, { backgroundColor: c }, textDraft.color === c && styles.swatchSel]}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}

      {/* Last child on purpose. This screen is a fullScreenModal, which iOS presents in
          its own container, so the app-wide button can't reach it — and mounted FIRST
          it rendered but wasn't tappable, because the absolutely-positioned top bar is
          painted after it and took the touch. */}
      {!textDraft && !exporting ? <ReportFab style={styles.reportFab} /> : null}
    </View>
  );
}

function ToolTab({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.tab} onPress={onPress}>
      <Ionicons name={icon} size={22} color={active ? BRAND.accent : '#fff'} />
      <Text style={[styles.tabLabel, active && { color: BRAND.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 6 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  doneBtn: { backgroundColor: BRAND.accent, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 18, minWidth: 60, alignItems: 'center' },
  doneText: { color: '#fff', fontWeight: '700' },
  canvasArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  panel: { backgroundColor: '#111' },
  rowPad: { paddingHorizontal: 12, paddingVertical: 10, gap: 10, flexDirection: 'row', alignItems: 'center' },
  // Below the top bar's controls, clear of Done and of the filter swatch row.
  reportFab: { bottom: undefined, top: 104, zIndex: 60 },
  filterChip: { alignItems: 'center', gap: 4, marginRight: 6 },
  filterSwatch: {
    width: SWATCH + 4,
    height: SWATCH + 4,
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: '#222',
    overflow: 'hidden',
  },
  filterSwatchCanvas: { width: SWATCH, height: SWATCH },
  chipLabel: { color: '#aaa', fontSize: 11 },
  chipActive: { color: BRAND.accent, fontWeight: '600' },
  sticker: { padding: 6 },
  drawRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  brushDotWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#333' },
  brushDotSel: { borderColor: BRAND.accent },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent' },
  swatchSel: { borderColor: '#fff' },
  addTextBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#222', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  addTextLabel: { color: '#fff', fontWeight: '600' },
  tabs: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#222' },
  tab: { alignItems: 'center', gap: 3 },
  tabLabel: { color: '#fff', fontSize: 11 },
  textModal: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.9)' },
  textModalBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  textModalInput: { flex: 1, fontSize: 30, fontWeight: '700', textAlign: 'center', paddingHorizontal: 24 },
  textModalControls: { paddingBottom: 30 },
  fontChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#333' },
  fontChipSel: { borderColor: BRAND.accent },
});

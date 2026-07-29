import { useCallback, useMemo, useState } from 'react';

import type { EditorDoc } from '@/components/media-editor/types';

/**
 * Undo/redo over the whole editor document. Every committed change (filter, add/move
 * text or sticker, brush stroke) pushes a new immutable doc; undo/redo just move an index
 * — so a single stack covers all edit types uniformly.
 */
export function useEditorHistory(initial: EditorDoc) {
  const [stack, setStack] = useState<EditorDoc[]>([initial]);
  const [index, setIndex] = useState(0);

  const doc = stack[index];

  const commit = useCallback(
    (next: EditorDoc) => {
      setStack((prev) => {
        const truncated = prev.slice(0, index + 1);
        truncated.push(next);
        return truncated;
      });
      setIndex((i) => i + 1);
    },
    [index],
  );

  /** Convenience: derive the next doc from the current one. */
  const update = useCallback(
    (fn: (d: EditorDoc) => EditorDoc) => commit(fn(stack[index])),
    [commit, stack, index],
  );

  const undo = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const redo = useCallback(() => setIndex((i) => Math.min(stack.length - 1, i + 1)), [stack.length]);

  return useMemo(
    () => ({
      doc,
      commit,
      update,
      undo,
      redo,
      canUndo: index > 0,
      canRedo: index < stack.length - 1,
    }),
    [doc, commit, update, undo, redo, index, stack.length],
  );
}

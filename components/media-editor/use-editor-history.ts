import { useCallback, useMemo, useState } from 'react';

import type { EditorDoc } from '@/components/media-editor/types';

type History = { stack: EditorDoc[]; index: number };

/**
 * Undo/redo over the whole editor document. Every committed change (filter, add/move
 * text or sticker, brush stroke) pushes a new immutable doc; undo/redo just move an index
 * — so a single stack covers all edit types uniformly.
 *
 * The stack and the index are ONE piece of state on purpose. They were two, and `commit`
 * truncated using the `index` captured at render while incrementing it with an updater.
 * Ending a pinch fires pan, pinch and rotate's onEnd in a single batch, so three commits
 * ran against the same stale index: each truncation discarded the previous push while the
 * index advanced three times, leaving index past the end of the stack. `doc` then read
 * undefined and the next render threw — a hard crash, since an unhandled throw in React
 * Native is a fatal. Deriving both from the same updater makes rapid successive commits
 * correct by construction.
 */
export function useEditorHistory(initial: EditorDoc) {
  const [{ stack, index }, setHistory] = useState<History>({ stack: [initial], index: 0 });

  // Defensive: nothing should be able to put the index out of range now, but a blank
  // editor is a far better failure than a crash if something ever does.
  const doc = stack[index] ?? stack[stack.length - 1] ?? initial;

  const commit = useCallback((next: EditorDoc) => {
    setHistory((h) => {
      const truncated = h.stack.slice(0, h.index + 1);
      truncated.push(next);
      return { stack: truncated, index: truncated.length - 1 };
    });
  }, []);

  /**
   * Derive the next doc from the current one. Reads the doc from inside the updater, so
   * a second commit in the same batch builds on the first rather than on a stale copy.
   */
  const update = useCallback((fn: (d: EditorDoc) => EditorDoc) => {
    setHistory((h) => {
      const current = h.stack[h.index] ?? h.stack[h.stack.length - 1];
      const next = fn(current);
      // Returning the same doc means "nothing changed" — don't grow the history. Ending
      // one pinch fires pan, pinch AND rotate's onEnd, and without this a single gesture
      // would cost three undo steps, two of them no-ops.
      if (next === current) return h;
      const truncated = h.stack.slice(0, h.index + 1);
      truncated.push(next);
      return { stack: truncated, index: truncated.length - 1 };
    });
  }, []);

  const undo = useCallback(
    () => setHistory((h) => ({ ...h, index: Math.max(0, h.index - 1) })),
    [],
  );
  const redo = useCallback(
    () => setHistory((h) => ({ ...h, index: Math.min(h.stack.length - 1, h.index + 1) })),
    [],
  );

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

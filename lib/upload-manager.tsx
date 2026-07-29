import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { trackFirst } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import { dismissCameraCoach } from '@/lib/coach-marks';
import {
  createPost,
  uploadToPipeline,
  UploadRejected,
  type PickedMedia,
  type PipelineResult,
} from '@/lib/upload';

// One composition in flight. Lives above the navigator so it survives leaving the
// compose screen — the upload keeps going in the background and the app-wide banner
// reports progress / completion.
export type Draft = {
  caption: string;
  altText: string;
  visibility: 'public' | 'private';
  attachLocation: boolean;
  tags: { name: string; source: 'user' | 'vision' | 'geo' }[];
};

type PipelinePhase = 'uploading' | 'ready' | 'rejected' | 'failed';

export type Composition = {
  id: string;
  media: PickedMedia;
  progress: number; // 0..1
  phase: PipelinePhase;
  result: PipelineResult | null;
  rejection: string | null; // adult-scan rejection message
  uploadError: string | null; // retryable failure
  draft: Draft;
  submitRequested: boolean; // user tapped Post before the upload finished
  posting: boolean;
  postedId: string | null;
  postError: string | null;
};

type UploadContextValue = {
  composition: Composition | null;
  /** Start a new composition from picked/captured media. */
  begin: (media: PickedMedia, defaults: { visibility: 'public' | 'private' }) => void;
  updateDraft: (patch: Partial<Draft>) => void;
  /** Retry a failed upload — keeps the draft (no re-entering caption/tags). */
  retryUpload: () => void;
  /** Post now if ready, else post automatically once the upload finishes. */
  submit: () => void;
  /** Clear the composition (discard, or after the user acknowledges completion). */
  clear: () => void;
};

const UploadContext = createContext<UploadContextValue | undefined>(undefined);

let counter = 0;
const nextId = () => `comp_${Date.now()}_${counter++}`;

export function UploadManagerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [composition, setComposition] = useState<Composition | null>(null);
  const ref = useRef<Composition | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const set = useCallback((updater: (c: Composition) => Composition) => {
    setComposition((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      ref.current = next;
      return next;
    });
  }, []);

  const doSubmit = useCallback(async () => {
    const c = ref.current;
    if (!c || !c.result || c.posting || c.postedId) return;
    set((x) => ({ ...x, posting: true, postError: null }));
    try {
      const id = await createPost({
        result: c.result,
        caption: c.draft.caption,
        altText: c.draft.altText,
        visibility: c.draft.visibility,
        attachLocation: c.draft.attachLocation,
        tags: c.draft.tags,
      });
      if (user?.id) void trackFirst(user.id, 'first_post'); // milestone only, no post id/media
      void dismissCameraCoach(); // first post made → the camera nudge is no longer needed
      set((x) => ({ ...x, posting: false, postedId: id }));
    } catch (e) {
      set((x) => ({
        ...x,
        posting: false,
        postError: e instanceof Error ? e.message : 'Could not post.',
      }));
    }
  }, [set, user?.id]);

  const runPipeline = useCallback(
    (id: string) => {
      const c = ref.current;
      if (!c || c.id !== id) return;
      const aborter = {
        aborted: false,
        onAbort: (cb: () => void) => {
          abortRef.current = cb;
        },
      };
      uploadToPipeline(
        c.media,
        (frac) => set((x) => (x.id === id ? { ...x, progress: frac } : x)),
        aborter,
      )
        .then((result) => {
          set((x) => (x.id === id ? { ...x, phase: 'ready', result, progress: 1 } : x));
          // If the user already asked to post, complete it now.
          if (ref.current?.submitRequested) void doSubmit();
        })
        .catch((err) => {
          if (err instanceof UploadRejected) {
            set((x) =>
              x.id === id
                ? { ...x, phase: 'rejected', rejection: rejectionMessage(err.message) }
                : x,
            );
          } else {
            set((x) =>
              x.id === id
                ? {
                    ...x,
                    phase: 'failed',
                    uploadError: err instanceof Error ? err.message : 'Upload failed.',
                  }
                : x,
            );
          }
        });
    },
    [set, doSubmit],
  );

  const begin = useCallback(
    (media: PickedMedia, defaults: { visibility: 'public' | 'private' }) => {
      abortRef.current?.();
      const comp: Composition = {
        id: nextId(),
        media,
        progress: 0,
        phase: 'uploading',
        result: null,
        rejection: null,
        uploadError: null,
        draft: {
          caption: '',
          altText: '',
          visibility: defaults.visibility,
          attachLocation: false,
          tags: [],
        },
        submitRequested: false,
        posting: false,
        postedId: null,
        postError: null,
      };
      ref.current = comp;
      setComposition(comp);
      runPipeline(comp.id);
    },
    [runPipeline],
  );

  const updateDraft = useCallback(
    (patch: Partial<Draft>) => {
      set((x) => ({ ...x, draft: { ...x.draft, ...patch } }));
    },
    [set],
  );

  const retryUpload = useCallback(() => {
    const c = ref.current;
    if (!c) return;
    set((x) => ({ ...x, phase: 'uploading', progress: 0, uploadError: null }));
    runPipeline(c.id);
  }, [set, runPipeline]);

  const submit = useCallback(() => {
    const c = ref.current;
    if (!c || c.phase === 'rejected' || c.posting || c.postedId) return;
    set((x) => ({ ...x, submitRequested: true }));
    if (c.phase === 'ready') void doSubmit();
    // else: doSubmit runs automatically when the pipeline resolves.
  }, [set, doSubmit]);

  const clear = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    ref.current = null;
    setComposition(null);
  }, []);

  const value = useMemo<UploadContextValue>(
    () => ({ composition, begin, updateDraft, retryUpload, submit, clear }),
    [composition, begin, updateDraft, retryUpload, submit, clear],
  );

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUpload(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be used within an UploadManagerProvider');
  return ctx;
}

// Non-accusatory, does not reveal thresholds or how to evade them.
function rejectionMessage(_reason: string): string {
  return "This media can't be posted because it doesn't meet our content guidelines.";
}

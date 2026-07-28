// ============================================================================
// vision.ts — PIPELINE STEP 4 (ADULT CONTENT SCAN) + VISION TAGGING.
//
// A SINGLE Google Cloud Vision `images:annotate` call returns BOTH the
// SafeSearch verdict (adult scan) and label suggestions, so we pay once.
// Thresholds are configuration (config.ts), never magic numbers here.
//
// FAIL-SAFE: if no vision provider is configured, we do NOT auto-approve —
// the caller flags the post for human review instead (see index.ts).
// ============================================================================
import { config } from './config.ts';

// Google SafeSearch likelihood → numeric 0..5.
const LIKELIHOOD: Record<string, number> = {
  UNKNOWN: 0, VERY_UNLIKELY: 1, UNLIKELY: 2, POSSIBLE: 3, LIKELY: 4, VERY_LIKELY: 5,
};

export type LabelSuggestion = { name: string; confidence: number };

export type VisionResult = {
  provider: 'google' | 'none';
  decision: 'reject' | 'flag' | 'approve';
  reason: string | null; // populated when decision === 'reject'
  scores: { adult: number; racy: number; violence: number } | null;
  labels: LabelSuggestion[];
};

function decide(scores: { adult: number; racy: number; violence: number }): { decision: 'reject' | 'flag' | 'approve'; reason: string | null } {
  const m = config.moderation;
  if (scores.adult >= m.adultRejectAt) return { decision: 'reject', reason: 'Adult content above the allowed threshold.' };
  if (scores.violence >= m.violenceRejectAt) return { decision: 'reject', reason: 'Graphic/violent content above the allowed threshold.' };
  if (scores.adult >= m.adultFlagAt || scores.racy >= m.racyFlagAt) return { decision: 'flag', reason: null };
  return { decision: 'approve', reason: null };
}

function normaliseLabels(raw: { description?: string; score?: number }[]): LabelSuggestion[] {
  const seen = new Set<string>();
  const out: LabelSuggestion[] = [];
  for (const l of raw) {
    const name = (l.description ?? '').trim().toLowerCase();
    const confidence = l.score ?? 0;
    if (!name) continue;
    if (confidence < config.tagging.labelMinConfidence) continue; // filter low confidence
    if (config.tagging.genericLabelDenylist.has(name)) continue; // filter uselessly generic
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, confidence });
  }
  return out;
}

/** Scan the (already stripped) display image and gather label suggestions. */
export async function scanAndLabel(displayJpeg: Uint8Array): Promise<VisionResult> {
  if (config.visionProvider === 'none' || !config.googleVisionApiKey) {
    // No provider → cannot certify safety → caller must flag for review.
    return { provider: 'none', decision: 'flag', reason: null, scores: null, labels: [] };
  }

  const b64 = base64Encode(displayJpeg);
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${config.googleVisionApiKey}`;
  const body = {
    requests: [{
      image: { content: b64 },
      features: [
        { type: 'SAFE_SEARCH_DETECTION' },
        { type: 'LABEL_DETECTION', maxResults: 25 },
      ],
    }],
  };

  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    // A failed scan must not silently approve. Surface as flag so a human reviews.
    return { provider: 'google', decision: 'flag', reason: null, scores: null, labels: [] };
  }
  const json = await res.json();
  const r = json?.responses?.[0] ?? {};
  const ss = r.safeSearchAnnotation ?? {};
  const scores = {
    adult: LIKELIHOOD[ss.adult] ?? 0,
    racy: LIKELIHOOD[ss.racy] ?? 0,
    violence: LIKELIHOOD[ss.violence] ?? 0,
  };
  const { decision, reason } = decide(scores);
  const labels = normaliseLabels(r.labelAnnotations ?? []);
  return { provider: 'google', decision, reason, scores, labels };
}

function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

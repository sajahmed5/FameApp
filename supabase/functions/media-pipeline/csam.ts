// ============================================================================
// csam.ts — PIPELINE STEP 5 (CSAM SCAN)
//
// ⚠️  NOT PRODUCTION READY — THIS IS A STUB. IT DETECTS NOTHING. ⚠️
//
// CSAM detection MUST be done with a licensed hash-matching service. Do NOT
// attempt to implement detection here. This module exists only to define the
// INTEGRATION POINT so a real client (e.g. Microsoft PhotoDNA, Thorn Safer,
// Google CSAI Match) can be dropped in without touching the rest of the
// pipeline: implement `CsamScanner.scan` against the provider's hash API and
// swap `stubScanner` for it in index.ts.
//
// A `reject` result MUST abort the pipeline (nothing stored) AND trigger the
// provider's/your legal reporting obligations (e.g. NCMEC CyberTipline). That
// reporting flow is intentionally out of scope for this stub and must be
// implemented alongside the real scanner.
// ============================================================================

export type CsamVerdict =
  | { status: 'pass' }
  | { status: 'reject'; caseRef: string };

export interface CsamScanner {
  /**
   * Inspect the (stripped) image bytes. Implementations should hash the image
   * and match against the provider's known-CSAM hash set. Must be fail-CLOSED:
   * on provider error, throw — do not return `pass`.
   */
  scan(bytes: Uint8Array, ctx: { userId: string; mime: string }): Promise<CsamVerdict>;
}

/**
 * Stub scanner: logs that a scan WOULD run and passes everything through.
 * Passing here means "not yet screened", NOT "verified safe". Replace before
 * accepting real-world uploads.
 */
export const stubScanner: CsamScanner = {
  // deno-lint-ignore require-await
  async scan(bytes, ctx): Promise<CsamVerdict> {
    console.warn(
      `[csam][STUB — NOT PRODUCTION READY] would scan ${bytes.length} bytes for user ${ctx.userId} (${ctx.mime}); passing through unscreened.`,
    );
    return { status: 'pass' };
  },
};

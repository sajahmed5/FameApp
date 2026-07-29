/**
 * Legal documents + the current terms version.
 *
 * The BODY text here is PLACEHOLDER — the founder supplies the real Terms, Privacy
 * Policy, and Community Guidelines and replaces the strings below. The MECHANISMS that
 * consume this (signup acceptance, the re-accept gate, the report-flow link, the settings
 * links) are wired to `TERMS_VERSION` + `LEGAL_DOCS`.
 *
 * Bump `TERMS_VERSION` whenever the Terms or Privacy text materially changes: the app
 * compares it to `profiles.terms_version` and re-prompts anyone on an older version.
 */
export const TERMS_VERSION = '2026-07-01';

export type LegalDocId = 'terms' | 'privacy' | 'guidelines';

export const LEGAL_DOCS: Record<LegalDocId, { title: string; updated: string; body: string }> = {
  terms: {
    title: 'Terms of Service',
    updated: TERMS_VERSION,
    body: `[PLACEHOLDER — Terms of Service]

This is placeholder text. Replace it with the final Terms of Service before launch.

It should cover at least: eligibility and the minimum age, acceptable use, the licence
you grant to content you post, the points system and any purchases, suspension and
termination, disclaimers and limitation of liability, and the governing law.`,
  },
  privacy: {
    title: 'Privacy Policy',
    updated: TERMS_VERSION,
    body: `[PLACEHOLDER — Privacy Policy]

This is placeholder text. Replace it with the final Privacy Policy before launch.

It should describe what personal data is collected and why, the lawful basis, how long
data is kept, who it is shared with (see the data-collection disclosure document), and
your rights to export and delete your data.`,
  },
  guidelines: {
    title: 'Community Guidelines',
    updated: TERMS_VERSION,
    body: `[PLACEHOLDER — Community Guidelines]

This is placeholder text. Replace it with the final Community Guidelines before launch.

They should set clear rules on: nudity and sexual content, harassment and hate, violence,
illegal content, spam and manipulation, and impersonation — and explain how content is
reported, reviewed, and removed, and how to appeal a decision.`,
  },
};

/**
 * Shared display formatting so counts read the same everywhere.
 *
 * `formatCount` abbreviates for compact UI (1.2k, 15.3k, 1.2M). The user's OWN analytics
 * screen wants exact figures, so it uses `formatFull` instead.
 */

/** Abbreviated count for feed/profile UI: 1.2k, 15.3k, 3.4M. */
export function formatCount(n: number): string {
  const v = Math.abs(n);
  if (v < 1000) return String(n);
  if (v < 1_000_000) {
    const k = n / 1000;
    // one decimal below 100k, none above (12.3k, but 153k)
    return `${trim(v < 100_000 ? k.toFixed(1) : Math.round(k).toString())}k`;
  }
  const m = n / 1_000_000;
  return `${trim(v < 100_000_000 ? m.toFixed(1) : Math.round(m).toString())}M`;
}

/** Exact, grouped number (e.g. own analytics): 15,342. */
export function formatFull(n: number): string {
  return Number(n).toLocaleString();
}

/** Drop a trailing ".0" (12.0k → 12k). */
function trim(s: string): string {
  return s.replace(/\.0$/, '');
}

/** Initials for an avatar fallback: "Ada Lovelace" → "AL", "@ada" → "A". */
export function initialsFor(name: string | null | undefined, handle?: string | null): string {
  const source = (name && name.trim()) || (handle && handle.replace(/^@/, '')) || '';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

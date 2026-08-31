// Pure model for the on-page highlight. The popup's flag rows and its LCP row
// toggle it; the overlay frames every matching image and shows a bar to step
// through them. No DOM and no browser.* calls: the label, the predicate, and
// the bar strings unit-test in node, and the popup and the overlay can never
// disagree on what a key means because both read it from here.
import type { HighlightKey, ImageFindings } from './types';

/** The card's four flag rows: every key but the LCP designation. */
export type FlagKey = Exclude<HighlightKey, 'lcp'>;

/** The four flag keys the Findings card lists, in card order. */
export const FLAG_KEYS: readonly FlagKey[] = ['oversized', 'altAbsent', 'missingLazy', 'legacyFormat'];

const LABELS: Record<HighlightKey, string> = {
  oversized: 'oversized',
  altAbsent: 'missing alt',
  missingLazy: 'not lazy',
  legacyFormat: 'legacy format',
  lcp: 'LCP image'
};

/** The row label in the popup and the bar label on the page: one string. */
export function highlightLabel(key: HighlightKey): string {
  return LABELS[key];
}

/** A fired flag is loss-toned; the LCP designation is accent-toned, not a defect. */
export function highlightTone(key: HighlightKey): 'loss' | 'accent' {
  return key === 'lcp' ? 'accent' : 'loss';
}

/** Narrow an untrusted message field to a key this build knows. */
export function isHighlightKey(value: unknown): value is HighlightKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LABELS, value);
}

/** Whether one image's findings belong to the highlighted set. */
export function matchesHighlight(key: HighlightKey, f: ImageFindings): boolean {
  switch (key) {
    case 'oversized':
      return f.oversized;
    case 'altAbsent':
      return f.altAbsent;
    case 'missingLazy':
      return f.missingLazy;
    case 'legacyFormat':
      return f.legacyFormat;
    case 'lcp':
      return f.facts.isLcp;
  }
}

/** Step `index` by `delta` within `total`, wrapping at both ends. */
export function stepIndex(index: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (((index + delta) % total) + total) % total;
}

export interface HighlightBarModel {
  label: string;
  tone: 'loss' | 'accent';
  /** `1 of 5`, or `none on page` once a re-collect has removed every match. */
  counter: string;
  /** Stepping needs at least two matches. */
  canStep: boolean;
  /** Group name for the bar; contains the visible label verbatim (WCAG 2.5.3). */
  ariaLabel: string;
}

/**
 * Everything the on-page bar renders for the active highlight. `index` is the
 * zero-based match the page last scrolled to; `total` counts the rendered
 * `<img>` elements framed, which can exceed the popup's per-resource count
 * when one resource is reused across several elements.
 */
export function buildHighlightBarModel(key: HighlightKey, index: number, total: number): HighlightBarModel {
  const label = highlightLabel(key);
  const counter = total > 0 ? `${Math.min(index, total - 1) + 1} of ${total}` : 'none on page';
  return {
    label,
    tone: highlightTone(key),
    counter,
    canStep: total > 1,
    ariaLabel: `${label}, ${counter}, highlighted on the page`
  };
}

// Pure string builders for the overlay badge chip and its hover panel. No DOM
// and no chrome.* calls: they take the per-image findings from the Task 4 lib
// and return display strings, so they unit-test in a plain node environment.
import { formatBytes } from '../shared/format';
import type { ImageFindings } from '../shared/types';

export interface BadgeLabel {
  /** Chip text, e.g. `jpeg 412 KB` (format token, then transfer size). */
  text: string;
  /** Any flag fired, so the chip should show a warning dot. */
  warn: boolean;
}

/** True when any per-image flag fired. */
export function hasWarning(f: ImageFindings): boolean {
  return f.legacyFormat || f.oversized || f.altAbsent || f.altEmpty || f.missingLazy || f.missingSrcset || f.dataUri;
}

/** Build the badge chip label: a format token plus the transfer size when known. */
export function buildBadgeLabel(f: ImageFindings): BadgeLabel {
  const format = f.facts.format ?? 'img';
  const text = f.facts.transferBytes !== null ? `${format} ${formatBytes(f.facts.transferBytes)}` : format;
  return { text, warn: hasWarning(f) };
}

/** `1600x1200 natural, 400x300 shown`: the size the browser fetched vs rendered. */
export function dimsLine(f: ImageFindings): string {
  const { naturalW, naturalH, displayW, displayH } = f.facts;
  return `${naturalW}x${naturalH} natural, ${displayW}x${displayH} shown`;
}

/**
 * Muted hover line explaining a missing size, or null. Shown only once the
 * Size probe has terminally failed (`sizeUnavailable`): while a probe is
 * pending the panel stays quiet rather than flashing an explanation for a size
 * that is about to arrive. Data URIs return null — the `inline data uri` flag
 * already explains them.
 */
export function sizeNoteLine(f: ImageFindings): string | null {
  if (f.facts.transferBytes !== null || !f.facts.sizeUnavailable || f.dataUri) return null;
  return /^https?:/i.test(f.facts.currentSrc) ? 'size unavailable (cross-origin)' : 'size unavailable';
}

/** Short lowercase lines describing each fired flag, for the hover panel. */
export function flagLines(f: ImageFindings): string[] {
  const lines: string[] = [];
  if (f.oversized) lines.push(`oversized ${Math.round(f.oversizeFactor * 10) / 10}x`);
  if (f.legacyFormat) lines.push(`legacy ${f.facts.format ?? 'format'}`);
  if (f.missingLazy) lines.push('not lazy-loaded');
  if (f.missingSrcset) lines.push('no srcset');
  if (f.altAbsent) lines.push('no alt text');
  if (f.altEmpty) lines.push('empty alt text');
  if (f.dataUri) lines.push('inline data uri');
  return lines;
}

/**
 * `est. saving 226 KB`, or null when the transfer size is unknown. Labeled
 * "est. saving" so it reads as an estimate distinct from the measured flags:
 * per-image savings can be nonzero even when `oversized` is false.
 */
export function savingLine(f: ImageFindings): string | null {
  if (f.estSavedBytes === null || f.estSavedBytes <= 0) return null;
  return `est. saving ${formatBytes(f.estSavedBytes)}`;
}

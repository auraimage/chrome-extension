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

/** One label/value row of the hover panel's facts grid. */
export interface PanelFact {
  label: string;
  value: string;
}

/**
 * Everything the hover panel renders, derived once per image. The overlay
 * consumes this instead of assembling strings inline so the panel's content
 * stays unit-testable without a DOM.
 */
export interface PanelModel {
  /** Format token for the header, `img` when unknown. */
  format: string;
  /** Transfer size for the header, or null when unknown. */
  size: string | null;
  /** The image is the page's LCP element (header tag). */
  isLcp: boolean;
  /** Header status: the flag count in the loss tone, or `no flags` in the win tone. */
  status: { text: string; tone: 'win' | 'loss' };
  facts: PanelFact[];
  /** Muted note explaining a missing size, or null (see sizeNote). */
  note: string | null;
  /** Short lowercase lines describing each fired flag. */
  flags: string[];
  /** `est. saving 226 KB · 55%`, or null when nothing is saved. */
  saving: string | null;
}

function dims(w: number, h: number): string {
  return `${w}×${h}`;
}

/**
 * Muted note explaining a missing size, or null. Shown only once the Size
 * probe has terminally failed (`sizeUnavailable`): while a probe is pending
 * the panel stays quiet rather than flashing an explanation for a size that
 * is about to arrive. Data URIs return null — the `inline data uri` flag
 * already explains them.
 */
function sizeNote(f: ImageFindings): string | null {
  if (f.facts.transferBytes !== null || !f.facts.sizeUnavailable || f.dataUri) return null;
  return /^https?:/i.test(f.facts.currentSrc) ? 'size unavailable (cross-origin)' : 'size unavailable';
}

/** Short lowercase lines describing each fired flag. */
function flagLines(f: ImageFindings): string[] {
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
 * `est. saving 226 KB · 55%`, or null when the transfer size is unknown.
 * Labeled "est. saving" so it reads as an estimate distinct from the measured
 * flags: per-image savings can be nonzero even when `oversized` is false. The
 * percent is appended only when the transfer size makes it meaningful.
 */
function savingLine(f: ImageFindings): string | null {
  if (f.estSavedBytes === null || f.estSavedBytes <= 0) return null;
  const base = `est. saving ${formatBytes(f.estSavedBytes)}`;
  const transfer = f.facts.transferBytes;
  if (transfer !== null && transfer > 0) {
    const pct = Math.round((f.estSavedBytes / transfer) * 100);
    if (pct >= 1 && pct < 100) return `${base} · ${pct}%`;
  }
  return base;
}

/** Derive the full hover-panel content for one image's findings. */
export function buildPanelModel(f: ImageFindings): PanelModel {
  const flags = flagLines(f);
  const { naturalW, naturalH, displayW, displayH, dpr } = f.facts;
  const dprSuffix = dpr !== 1 ? ` @${Math.round(dpr * 10) / 10}x` : '';
  const facts: PanelFact[] = [
    { label: 'natural', value: dims(naturalW, naturalH) },
    { label: 'shown', value: `${dims(displayW, displayH)}${dprSuffix}` }
  ];
  const contexts = f.facts.displayContexts ?? 1;
  if (contexts > 1) facts.push({ label: 'used', value: `${contexts} places` });
  return {
    format: f.facts.format ?? 'img',
    size: f.facts.transferBytes !== null ? formatBytes(f.facts.transferBytes) : null,
    isLcp: f.facts.isLcp,
    status:
      flags.length > 0
        ? { text: flags.length === 1 ? '1 flag' : `${flags.length} flags`, tone: 'loss' }
        : { text: 'no flags', tone: 'win' },
    facts,
    note: sizeNote(f),
    flags,
    saving: savingLine(f)
  };
}

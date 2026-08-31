// Pure view-model for the popup Findings card. One builder feeds three
// renderers (the DOM card, the copied markdown, and the PNG canvas) so they
// never drift. No DOM and no chrome.* calls here; it takes the folded
// PageFindings from the content script and returns display values only.
import { detectCdn } from '../shared/competitors';
import { formatBytes } from '../shared/format';
import { FLAG_KEYS, type FlagKey, highlightLabel } from '../shared/highlight';
import type { FindingCounts, PageFindings } from '../shared/types';

export interface FlagStat {
  /** The highlight the row toggles on the page. */
  key: FlagKey;
  label: string;
  count: number;
}

/** Which page-level count each card flag reads. */
const FLAG_COUNT: Record<FlagKey, keyof FindingCounts> = {
  oversized: 'oversized',
  altAbsent: 'altAbsent',
  missingLazy: 'missingLazy',
  legacyFormat: 'legacyFormat'
};

/** One row of the `fix first` list: an https image ranked by estimated saving. */
export interface FixFirstItem {
  /** The image's currentSrc, handed back to the content script to open the optimize panel. */
  src: string;
  /** Short display name (last path segment). */
  name: string;
  /** e.g. `2.1 MB`: the estimated bytes saved by optimizing this one image. */
  savingText: string;
}

/** How many `fix first` rows the card shows. */
export const FIX_FIRST_LIMIT = 3;

export interface FindingsCardModel {
  hostname: string;
  /** Count of rendered <img> elements (matches the on-page badge count). */
  imageCount: number;
  totalBytesText: string;
  /** Raw estimated wasteful bytes; the renderers pick the loss/win tone from it. */
  wastefulBytes: number;
  wastefulBytesText: string;
  /** e.g. `0.4 s`, or null when the estimate rounds to zero. */
  estLcpSavingText: string | null;
  /** Basename of the LCP image, or null when it is unknown. */
  lcpImageName: string | null;
  /** Always four rows so the card and PNG keep a stable shape. */
  flags: FlagStat[];
  /** Up to FIX_FIRST_LIMIT https images with a positive estimated saving, largest first. */
  fixFirst: FixFirstItem[];
  /** A recognized competing CDN vendor's name, or null (our own edge is skipped). */
  cdnName: string | null;
}

/** Derive a short, human name for an image URL: its last path segment. */
export function imageName(url: string): string {
  if (url.startsWith('data:')) return 'inline image';
  try {
    const { pathname } = new URL(url);
    const last = pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : 'image';
  } catch {
    return 'image';
  }
}

/** Sum the known transfer bytes across the folded resources (nulls count as 0). */
function totalTransferBytes(findings: PageFindings): number {
  let total = 0;
  for (const img of findings.images) total += img.facts.transferBytes ?? 0;
  return total;
}

/** First recognized competing CDN across the images; our own edge is not "competing". */
function detectCompetingCdn(findings: PageFindings): string | null {
  for (const img of findings.images) {
    const vendor = detectCdn(img.facts.currentSrc);
    if (vendor && vendor.id !== 'auraimage') return vendor.name;
  }
  return null;
}

/**
 * The images worth fixing first: public https resources (the only ones the
 * optimize panel can transform) with a positive estimated saving, ranked by
 * that saving and capped at FIX_FIRST_LIMIT.
 */
function rankFixFirst(findings: PageFindings): FixFirstItem[] {
  return findings.images
    .filter((img) => /^https:/i.test(img.facts.currentSrc) && (img.estSavedBytes ?? 0) > 0)
    .sort((a, b) => (b.estSavedBytes ?? 0) - (a.estSavedBytes ?? 0))
    .slice(0, FIX_FIRST_LIMIT)
    .map((img) => ({
      src: img.facts.currentSrc,
      name: imageName(img.facts.currentSrc),
      savingText: formatBytes(img.estSavedBytes ?? 0)
    }));
}

export function buildFindingsCardModel(input: {
  hostname: string;
  findings: PageFindings;
  imageCount: number;
}): FindingsCardModel {
  const { hostname, findings, imageCount } = input;
  const lcp = findings.images.find((img) => img.facts.isLcp);

  return {
    hostname,
    imageCount,
    totalBytesText: formatBytes(totalTransferBytes(findings)),
    wastefulBytes: findings.wastefulBytes,
    wastefulBytesText: formatBytes(findings.wastefulBytes),
    estLcpSavingText: findings.estLcpSavingSeconds > 0 ? `${findings.estLcpSavingSeconds} s` : null,
    lcpImageName: lcp ? imageName(lcp.facts.currentSrc) : null,
    flags: FLAG_KEYS.map((key) => ({ key, label: highlightLabel(key), count: findings.counts[FLAG_COUNT[key]] })),
    fixFirst: rankFixFirst(findings),
    cdnName: detectCompetingCdn(findings)
  };
}

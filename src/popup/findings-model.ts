// Pure view-model for the popup Findings card. One builder feeds three
// renderers (the DOM card, the copied markdown, and the PNG canvas) so they
// never drift. No DOM and no chrome.* calls here; it takes the folded
// PageFindings from the content script and returns display strings only.
import { detectCdn } from '../shared/competitors';
import { formatBytes } from '../shared/format';
import type { PageFindings } from '../shared/types';

export interface FlagStat {
  label: string;
  count: number;
}

export interface FindingsCardModel {
  hostname: string;
  /** Count of rendered <img> elements (matches the on-page badge count). */
  imageCount: number;
  totalBytesText: string;
  wastefulBytesText: string;
  /** e.g. `0.4 s`, or null when the estimate rounds to zero. */
  estLcpSavingText: string | null;
  /** Basename of the LCP image, or null when it is unknown. */
  lcpImageName: string | null;
  /** Always four rows so the card and PNG keep a stable shape. */
  flags: FlagStat[];
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
    wastefulBytesText: formatBytes(findings.wastefulBytes),
    estLcpSavingText: findings.estLcpSavingSeconds > 0 ? `${findings.estLcpSavingSeconds} s` : null,
    lcpImageName: lcp ? imageName(lcp.facts.currentSrc) : null,
    flags: [
      { label: 'oversized', count: findings.counts.oversized },
      { label: 'missing alt', count: findings.counts.altAbsent },
      { label: 'not lazy', count: findings.counts.missingLazy },
      { label: 'legacy format', count: findings.counts.legacyFormat }
    ],
    cdnName: detectCompetingCdn(findings)
  };
}

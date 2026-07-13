// Ambient-pass analysis: pure functions over plain image facts. No DOM APIs and
// no chrome.* calls live here — Task 5's content script gathers the facts and
// hands them in. Per ADR 0015 there is deliberately no composite score/grade/
// health: only per-flag facts, byte counts, and time estimates.
import type { AmbientImageFacts, FindingCounts, ImageFindings, PageFindings } from './types';

/** Raster formats with a cheaper modern (AVIF/WebP) alternative. */
const LEGACY_FORMATS = new Set(['jpeg', 'jpg', 'png', 'gif']);

/** An image counts as oversized past this multiple of the pixels it renders. */
const OVERSIZE_THRESHOLD = 1.5;

/** Fraction of a legacy image's transfer bytes saved by re-encoding to AVIF. */
const LEGACY_TO_AVIF_SAVING = 0.55;

// Bytes-to-seconds assumption reused verbatim from
// packages/mcp-server/src/tools/audit-lcp.ts line 70:
//   const estimatedLcpSavingSeconds = (totalBytes * 0.7) / (25_000_000 / 8);
// The `(25_000_000 / 8)` divisor models a 25 Mbps connection (bytes per
// second); the trailing Math.round(x * 10) / 10 rounds to one decimal. audit-lcp
// multiplies by 0.7 as a stand-in for "fraction of bytes that are savable"
// because it only has on-disk file sizes. We already compute exact per-image
// savings (wastefulBytes), so we feed those directly and drop the 0.7 (applying
// it would double-discount). This resolves the formula-shape mismatch the brief
// flagged.
const BYTES_PER_SECOND = 25_000_000 / 8;

/** Analyze one image's static facts into per-flag findings and a byte estimate. */
export function analyzeImage(facts: AmbientImageFacts): ImageFindings {
  const { naturalW, displayW, dpr, alt, loading, hasSrcset, transferBytes, format, currentSrc } = facts;
  const displayContexts = facts.displayContexts ?? 1;

  // currentSrc is the resource the browser actually loaded, so its format
  // already reflects the winner of any <picture> negotiation: a legacy format
  // here means no modern sibling out-competed it.
  const legacyFormat = format !== null && LEGACY_FORMATS.has(format.toLowerCase());

  // Physical pixels the image renders at; 0 when it is not laid out (e.g. hidden).
  const neededW = displayW * dpr;
  const oversizeFactor = neededW > 0 ? naturalW / neededW : 0;
  const oversized = neededW > 0 && naturalW > neededW * OVERSIZE_THRESHOLD;

  const altAbsent = alt === null;
  const altEmpty = alt !== null && alt.trim() === '';

  const missingLazy = loading !== 'lazy';
  const missingSrcset = !hasSrcset && (oversized || displayContexts > 1);
  const dataUri = currentSrc.startsWith('data:');

  return {
    facts,
    legacyFormat,
    oversized,
    oversizeFactor,
    altAbsent,
    altEmpty,
    missingLazy,
    missingSrcset,
    dataUri,
    estSavedBytes: estimateSavedBytes({ legacyFormat, neededW, naturalW, transferBytes })
  };
}

/**
 * Estimate transfer bytes saved by optimizing an image. Two stacked terms:
 *  1. Legacy -> AVIF re-encode saves {@link LEGACY_TO_AVIF_SAVING} of the bytes.
 *  2. Resizing to the rendered width saves a share of the *remaining* bytes,
 *     scaled by area: 1 - min(1, neededW/naturalW)^2. This term self-zeroes when
 *     the image is not larger than it renders, so it needs no explicit gate.
 * Returns null when transferBytes is unknown (cross-origin without
 * Timing-Allow-Origin), so estimates degrade gracefully rather than lying.
 */
function estimateSavedBytes({
  legacyFormat,
  neededW,
  naturalW,
  transferBytes
}: {
  legacyFormat: boolean;
  neededW: number;
  naturalW: number;
  transferBytes: number | null;
}): number | null {
  if (transferBytes === null) return null;

  const savedFromLegacy = legacyFormat ? LEGACY_TO_AVIF_SAVING * transferBytes : 0;
  const remainder = transferBytes - savedFromLegacy;

  const widthRatio = naturalW > 0 && neededW > 0 ? neededW / naturalW : 1;
  const oversizeSavingFraction = 1 - Math.min(1, widthRatio) ** 2;
  const savedFromOversize = oversizeSavingFraction * remainder;

  return Math.round(savedFromLegacy + savedFromOversize);
}

/** Roll per-image findings up into page-level counts, bytes, and estimates. */
export function aggregate(images: ImageFindings[]): PageFindings {
  const counts: FindingCounts = {
    legacyFormat: 0,
    oversized: 0,
    altAbsent: 0,
    altEmpty: 0,
    missingLazy: 0,
    missingSrcset: 0,
    dataUri: 0
  };
  let wastefulBytes = 0;

  for (const img of images) {
    if (img.legacyFormat) counts.legacyFormat++;
    if (img.oversized) counts.oversized++;
    if (img.altAbsent) counts.altAbsent++;
    if (img.altEmpty) counts.altEmpty++;
    if (img.missingLazy) counts.missingLazy++;
    if (img.missingSrcset) counts.missingSrcset++;
    if (img.dataUri) counts.dataUri++;
    wastefulBytes += img.estSavedBytes ?? 0;
  }

  const estLcpSavingSeconds = Math.round((wastefulBytes / BYTES_PER_SECOND) * 10) / 10;

  return {
    images,
    totalImages: images.length,
    counts,
    wastefulBytes,
    estLcpSavingSeconds
  };
}

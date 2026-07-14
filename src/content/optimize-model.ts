// Pure view-model for the optimize panel's before/after comparison. No DOM and
// no chrome.* calls: it turns DemoStats into labeled, tone-tagged bar rows so
// the proof logic (widths, deltas, the honest "already optimized" case) is
// unit-testable in plain node. Tones are semantic, not decorative: `loss` is
// bytes the page is paying today, `win` is a real measured saving, `neutral`
// means the re-encode does not help (never painted as a win).
import { formatBytes } from '../shared/format';
import type { DemoStats } from '../shared/types';

export type ComparisonTone = 'loss' | 'win' | 'neutral';

export interface ComparisonRow {
  label: 'original' | 'avif' | 'webp';
  bytes: number;
  /** Bar length relative to the original, clamped to 2..100 so tiny wins stay visible. */
  widthPct: number;
  /** Right column: the format token for the original, `-N%` for the encodes. */
  note: string;
  tone: ComparisonTone;
}

export interface ComparisonModel {
  /** `saves 2.2 MB (96%)`, or `already optimized` when re-encoding cannot win. */
  headline: string;
  headlineTone: 'win' | 'neutral';
  rows: ComparisonRow[];
}

function clampPct(bytes: number, originalBytes: number): number {
  if (originalBytes <= 0) return 2;
  return Math.min(100, Math.max(2, Math.round((bytes / originalBytes) * 100)));
}

function savedPercent(originalBytes: number, encodedBytes: number): number {
  if (originalBytes <= 0) return 0;
  // Never show negative savings: an already-optimized source can re-encode larger.
  return Math.max(0, Math.round(100 * (1 - encodedBytes / originalBytes)));
}

function encodeRow(label: 'avif' | 'webp', bytes: number, originalBytes: number): ComparisonRow {
  const pct = savedPercent(originalBytes, bytes);
  return {
    label,
    bytes,
    widthPct: clampPct(bytes, originalBytes),
    note: `-${pct}%`,
    tone: pct > 0 ? 'win' : 'neutral'
  };
}

export function buildComparison(stats: DemoStats): ComparisonModel {
  const avif = encodeRow('avif', stats.avifBytes, stats.originalBytes);
  const webp = encodeRow('webp', stats.webpBytes, stats.originalBytes);
  const bestPct = Math.max(savedPercent(stats.originalBytes, stats.avifBytes), 0);
  const anyWin = avif.tone === 'win' || webp.tone === 'win';

  const original: ComparisonRow = {
    label: 'original',
    bytes: stats.originalBytes,
    widthPct: 100,
    note: stats.originalFormat || 'img',
    // Red only when there are real bytes to win back; an already-optimized
    // original is not a cost worth alarming about.
    tone: anyWin ? 'loss' : 'neutral'
  };

  const savedBytes = Math.max(0, stats.originalBytes - stats.avifBytes);
  const headline =
    bestPct > 0 && savedBytes > 0 ? `saves ${formatBytes(savedBytes)} (${bestPct}%)` : 'already optimized';

  return {
    headline,
    headlineTone: bestPct > 0 && savedBytes > 0 ? 'win' : 'neutral',
    rows: [original, avif, webp]
  };
}

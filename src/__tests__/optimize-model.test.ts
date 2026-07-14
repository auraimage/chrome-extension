import { buildComparison } from '../content/optimize-model';
import type { DemoStats } from '../shared/types';
import { describe, expect, it } from 'vitest';

function stats(overrides: Partial<DemoStats> = {}): DemoStats {
  return {
    sourceUrl: 'https://example.com/hero.jpg',
    originalBytes: 2_400_000,
    originalFormat: 'jpeg',
    width: 1920,
    height: 1080,
    appliedWidth: 1920,
    avifBytes: 180_000,
    webpBytes: 240_000,
    blurhash: '',
    savingsPercent: 93,
    ...overrides
  };
}

describe('buildComparison', () => {
  it('leads with the avif saving in bytes and percent', () => {
    const model = buildComparison(stats());
    expect(model.headline).toBe('saves 2.2 MB (93%)');
    expect(model.headlineTone).toBe('win');
  });

  it('tones the original as loss and the encodes as win, with proportional bars', () => {
    const [original, avif, webp] = buildComparison(stats()).rows;
    expect(original).toMatchObject({ label: 'original', widthPct: 100, note: 'jpeg', tone: 'loss' });
    expect(avif).toMatchObject({ label: 'avif', widthPct: 8, note: '-93%', tone: 'win' });
    expect(webp).toMatchObject({ label: 'webp', widthPct: 10, note: '-90%', tone: 'win' });
  });

  it('never paints a larger re-encode as a win, and says already optimized', () => {
    const model = buildComparison(stats({ avifBytes: 2_500_000, webpBytes: 2_600_000, savingsPercent: 0 }));
    expect(model.headline).toBe('already optimized');
    expect(model.headlineTone).toBe('neutral');
    for (const row of model.rows) expect(row.tone).toBe('neutral');
    expect(model.rows[1]?.note).toBe('-0%');
    // Bars cap at the original's length even when the encode is larger.
    expect(model.rows[1]?.widthPct).toBe(100);
  });

  it('keeps a tiny encode visible with the 2% bar floor', () => {
    const model = buildComparison(stats({ avifBytes: 1_000 }));
    expect(model.rows[1]?.widthPct).toBe(2);
  });

  it('degrades a zero-byte original to neutral instead of NaN', () => {
    const model = buildComparison(stats({ originalBytes: 0 }));
    expect(model.headline).toBe('already optimized');
    for (const row of model.rows) {
      expect(Number.isFinite(row.widthPct)).toBe(true);
      expect(row.tone).toBe('neutral');
    }
  });

  it('falls back to "img" when the original format is empty', () => {
    expect(buildComparison(stats({ originalFormat: '' })).rows[0]?.note).toBe('img');
  });
});

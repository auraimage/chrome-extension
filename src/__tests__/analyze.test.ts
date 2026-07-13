import { aggregate, analyzeImage } from '../shared/analyze';
import type { AmbientImageFacts, ImageFindings } from '../shared/types';
import { describe, expect, it } from 'vitest';

/** A benign, fully-optimized image: no flags should fire. */
function baseFacts(overrides: Partial<AmbientImageFacts> = {}): AmbientImageFacts {
  return {
    currentSrc: 'https://cdn.example.com/hero.avif',
    naturalW: 800,
    naturalH: 600,
    displayW: 800,
    displayH: 600,
    dpr: 1,
    alt: 'A descriptive alt',
    loading: 'lazy',
    hasSrcset: true,
    transferBytes: 1000,
    format: 'avif',
    isLcp: false,
    ...overrides
  };
}

describe('analyzeImage — legacyFormat flag', () => {
  it.each(['jpeg', 'jpg', 'png', 'gif', 'JPEG', 'PNG'])('flags legacy format %s', (format) => {
    expect(analyzeImage(baseFacts({ format })).legacyFormat).toBe(true);
  });

  it.each(['webp', 'avif', 'svg', null])('does not flag modern/unknown format %s', (format) => {
    expect(analyzeImage(baseFacts({ format })).legacyFormat).toBe(false);
  });
});

describe('analyzeImage — oversized flag and factor (dpr 1/2/3)', () => {
  it('flags oversized at dpr 1 when naturalW > displayW * dpr * 1.5', () => {
    const f = analyzeImage(baseFacts({ naturalW: 2000, displayW: 500, dpr: 1 }));
    expect(f.oversized).toBe(true);
    expect(f.oversizeFactor).toBe(4); // 2000 / (500 * 1)
  });

  it('does not flag at exactly the 1.5x threshold', () => {
    const f = analyzeImage(baseFacts({ naturalW: 1500, displayW: 1000, dpr: 1 }));
    expect(f.oversized).toBe(false); // 1500 is not > 1500
    expect(f.oversizeFactor).toBe(1.5);
  });

  it('accounts for dpr 2 (retina needs twice the pixels)', () => {
    const f = analyzeImage(baseFacts({ naturalW: 2000, displayW: 500, dpr: 2 }));
    expect(f.oversized).toBe(true); // 2000 > 500 * 2 * 1.5 = 1500
    expect(f.oversizeFactor).toBe(2); // 2000 / (500 * 2)
  });

  it('is not oversized at dpr 2 when it just covers the retina need', () => {
    const f = analyzeImage(baseFacts({ naturalW: 1400, displayW: 500, dpr: 2 }));
    expect(f.oversized).toBe(false); // 1400 < 1500
  });

  it('accounts for dpr 3 at the boundary', () => {
    const justOver = analyzeImage(baseFacts({ naturalW: 1801, displayW: 400, dpr: 3 }));
    const atBoundary = analyzeImage(baseFacts({ naturalW: 1800, displayW: 400, dpr: 3 }));
    expect(justOver.oversized).toBe(true); // 1801 > 400 * 3 * 1.5 = 1800
    expect(atBoundary.oversized).toBe(false); // 1800 is not > 1800
  });

  it('reports factor 0 and is not oversized when render size is unknown', () => {
    const f = analyzeImage(baseFacts({ naturalW: 2000, displayW: 0, dpr: 1 }));
    expect(f.oversized).toBe(false);
    expect(f.oversizeFactor).toBe(0);
  });
});

describe('analyzeImage — alt flags (absent vs empty)', () => {
  it('flags altAbsent when alt is null', () => {
    const f = analyzeImage(baseFacts({ alt: null }));
    expect(f.altAbsent).toBe(true);
    expect(f.altEmpty).toBe(false);
  });

  it('flags altEmpty when alt is present but blank', () => {
    const f = analyzeImage(baseFacts({ alt: '   ' }));
    expect(f.altAbsent).toBe(false);
    expect(f.altEmpty).toBe(true);
  });

  it('flags neither when alt has content', () => {
    const f = analyzeImage(baseFacts({ alt: 'hero banner' }));
    expect(f.altAbsent).toBe(false);
    expect(f.altEmpty).toBe(false);
  });
});

describe('analyzeImage — missingLazy flag', () => {
  it.each(['eager', '', 'auto'])('flags missingLazy when loading is %s', (loading) => {
    expect(analyzeImage(baseFacts({ loading })).missingLazy).toBe(true);
  });

  it('does not flag when loading is lazy', () => {
    expect(analyzeImage(baseFacts({ loading: 'lazy' })).missingLazy).toBe(false);
  });

  it('flags missingLazy even for the LCP image (Task 4 reports facts, not advice)', () => {
    expect(analyzeImage(baseFacts({ loading: 'eager', isLcp: true })).missingLazy).toBe(true);
  });
});

describe('analyzeImage — missingSrcset flag (both arms)', () => {
  it('flags when there is no srcset and the image is oversized', () => {
    const f = analyzeImage(baseFacts({ hasSrcset: false, naturalW: 2000, displayW: 500, dpr: 1 }));
    expect(f.oversized).toBe(true);
    expect(f.missingSrcset).toBe(true);
  });

  it('flags when there is no srcset and the image has >1 display context', () => {
    const f = analyzeImage(baseFacts({ hasSrcset: false, displayContexts: 2 }));
    expect(f.oversized).toBe(false);
    expect(f.missingSrcset).toBe(true);
  });

  it('does not flag when there is no srcset but a single, correctly-sized context', () => {
    const f = analyzeImage(baseFacts({ hasSrcset: false, displayContexts: 1 }));
    expect(f.missingSrcset).toBe(false);
  });

  it('does not flag when srcset is present even if oversized', () => {
    const f = analyzeImage(baseFacts({ hasSrcset: true, naturalW: 2000, displayW: 500, dpr: 1 }));
    expect(f.missingSrcset).toBe(false);
  });
});

describe('analyzeImage — dataUri flag', () => {
  it('flags inline data URIs', () => {
    const f = analyzeImage(baseFacts({ currentSrc: 'data:image/png;base64,AAAA' }));
    expect(f.dataUri).toBe(true);
  });

  it('does not flag http(s) URLs', () => {
    expect(analyzeImage(baseFacts({ currentSrc: 'https://cdn.example.com/x.avif' })).dataUri).toBe(false);
  });
});

describe('analyzeImage — estSavedBytes', () => {
  it('saves 55% of transfer bytes for a legacy, correctly-sized image', () => {
    const f = analyzeImage(baseFacts({ format: 'jpeg', transferBytes: 1000, naturalW: 800, displayW: 800, dpr: 1 }));
    expect(f.estSavedBytes).toBe(550); // 0.55 * 1000
  });

  it('saves the oversize fraction of the remainder for a modern, oversized image', () => {
    const f = analyzeImage(baseFacts({ format: 'webp', transferBytes: 1000, naturalW: 2000, displayW: 500, dpr: 1 }));
    // ratio = 500/2000 = 0.25; oversize fraction = 1 - 0.25^2 = 0.9375; 0.9375 * 1000
    expect(f.estSavedBytes).toBe(938); // Math.round(937.5)
  });

  it('combines legacy and oversize savings on the remainder', () => {
    const f = analyzeImage(baseFacts({ format: 'jpeg', transferBytes: 1000, naturalW: 2000, displayW: 500, dpr: 1 }));
    // legacy: 550; remainder 450; oversize fraction 0.9375 -> 421.875; total 971.875
    expect(f.estSavedBytes).toBe(972);
  });

  it('accounts for dpr when computing the oversize fraction', () => {
    const f = analyzeImage(baseFacts({ format: 'webp', transferBytes: 1000, naturalW: 2000, displayW: 500, dpr: 2 }));
    // ratio = (500*2)/2000 = 0.5; fraction = 1 - 0.25 = 0.75 -> 750
    expect(f.estSavedBytes).toBe(750);
  });

  it('returns null when transferBytes is unknown (cross-origin without Timing-Allow-Origin)', () => {
    const f = analyzeImage(baseFacts({ transferBytes: null, format: 'jpeg', naturalW: 2000, displayW: 500 }));
    expect(f.estSavedBytes).toBeNull();
  });

  it('estimates zero savings when transferBytes is zero (distinct from unknown null)', () => {
    const f = analyzeImage(baseFacts({ transferBytes: 0, format: 'jpeg', naturalW: 2000, displayW: 500 }));
    expect(f.estSavedBytes).toBe(0);
  });

  it('estimates zero savings for a modern, correctly-sized image', () => {
    const f = analyzeImage(baseFacts({ format: 'avif', transferBytes: 1000, naturalW: 800, displayW: 800, dpr: 1 }));
    expect(f.estSavedBytes).toBe(0);
  });
});

describe('aggregate', () => {
  function findings(overrides: Partial<ImageFindings>): ImageFindings {
    return {
      facts: baseFacts(),
      legacyFormat: false,
      oversized: false,
      oversizeFactor: 1,
      altAbsent: false,
      altEmpty: false,
      missingLazy: false,
      missingSrcset: false,
      dataUri: false,
      estSavedBytes: 0,
      ...overrides
    };
  }

  it('returns an empty aggregate for no images', () => {
    const agg = aggregate([]);
    expect(agg.totalImages).toBe(0);
    expect(agg.wastefulBytes).toBe(0);
    expect(agg.estLcpSavingSeconds).toBe(0);
    expect(agg.counts).toEqual({
      legacyFormat: 0,
      oversized: 0,
      altAbsent: 0,
      altEmpty: 0,
      missingLazy: 0,
      missingSrcset: 0,
      dataUri: 0
    });
  });

  it('totals counts, bytes, and LCP seconds across images', () => {
    const agg = aggregate([
      findings({ legacyFormat: true, altAbsent: true, estSavedBytes: 1_000_000 }),
      findings({ legacyFormat: true, oversized: true, missingLazy: true, estSavedBytes: 2_125_000 }),
      findings({ dataUri: true, estSavedBytes: null }) // null estimate treated as 0
    ]);
    expect(agg.totalImages).toBe(3);
    expect(agg.counts).toEqual({
      legacyFormat: 2,
      oversized: 1,
      altAbsent: 1,
      altEmpty: 0,
      missingLazy: 1,
      missingSrcset: 0,
      dataUri: 1
    });
    expect(agg.wastefulBytes).toBe(3_125_000);
    // 3_125_000 bytes / (25_000_000 / 8) bytes-per-second = 1.0 s
    expect(agg.estLcpSavingSeconds).toBe(1);
  });

  it('rounds estLcpSavingSeconds to one decimal', () => {
    const agg = aggregate([findings({ estSavedBytes: 1_000_000 })]);
    // 1_000_000 / 3_125_000 = 0.32
    expect(agg.estLcpSavingSeconds).toBe(0.3);
  });

  it('echoes the per-image findings', () => {
    const list = [findings({ legacyFormat: true })];
    expect(aggregate(list).images).toEqual(list);
  });
});

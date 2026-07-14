import { buildBadgeLabel, dimsLine, flagLines, hasWarning, savingLine, sizeNoteLine } from '../content/badge-label';
import { analyzeImage } from '../shared/analyze';
import type { AmbientImageFacts } from '../shared/types';
import { describe, expect, it } from 'vitest';

/** A benign, fully-optimized image: no flags fire. */
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
    transferBytes: 120_000,
    format: 'avif',
    isLcp: false,
    ...overrides
  };
}

describe('buildBadgeLabel', () => {
  it('joins the format token and the transfer size', () => {
    const label = buildBadgeLabel(analyzeImage(baseFacts({ format: 'jpeg', transferBytes: 412_000 })));
    expect(label.text).toBe('jpeg 412 KB');
  });

  it('falls back to "img" when the format is unknown', () => {
    expect(buildBadgeLabel(analyzeImage(baseFacts({ format: null }))).text).toBe('img 120 KB');
  });

  it('drops the size when transfer bytes are unknown (cross-origin opaque)', () => {
    expect(buildBadgeLabel(analyzeImage(baseFacts({ format: 'webp', transferBytes: null }))).text).toBe('webp');
  });

  it('sets warn=false for a clean image and warn=true when any flag fires', () => {
    expect(buildBadgeLabel(analyzeImage(baseFacts())).warn).toBe(false);
    expect(buildBadgeLabel(analyzeImage(baseFacts({ loading: 'eager' }))).warn).toBe(true);
  });
});

describe('hasWarning', () => {
  it('is false only when every flag is clear', () => {
    expect(hasWarning(analyzeImage(baseFacts()))).toBe(false);
  });

  it('is true when the format is legacy', () => {
    expect(hasWarning(analyzeImage(baseFacts({ format: 'png' })))).toBe(true);
  });
});

describe('dimsLine', () => {
  it('reports natural then shown dimensions', () => {
    const line = dimsLine(analyzeImage(baseFacts({ naturalW: 1600, naturalH: 1200, displayW: 400, displayH: 300 })));
    expect(line).toBe('1600x1200 natural, 400x300 shown');
  });
});

describe('flagLines', () => {
  it('is empty for a clean image', () => {
    expect(flagLines(analyzeImage(baseFacts()))).toEqual([]);
  });

  it('lists oversized with its rounded factor and the legacy format token', () => {
    const lines = flagLines(analyzeImage(baseFacts({ naturalW: 2000, displayW: 500, dpr: 1, format: 'jpeg' })));
    expect(lines).toContain('oversized 4x');
    expect(lines).toContain('legacy jpeg');
  });

  it('reports a missing alt attribute', () => {
    expect(flagLines(analyzeImage(baseFacts({ alt: null })))).toContain('no alt text');
  });

  it('reports an empty alt attribute distinctly', () => {
    expect(flagLines(analyzeImage(baseFacts({ alt: '  ' })))).toContain('empty alt text');
  });

  it('contains no em dash', () => {
    const lines = flagLines(analyzeImage(baseFacts({ loading: 'eager', format: 'png', alt: null })));
    expect(lines.join('\n')).not.toContain('—');
  });
});

describe('savingLine', () => {
  it('is null when no bytes are saved', () => {
    expect(savingLine(analyzeImage(baseFacts()))).toBeNull();
  });

  it('is null when transfer bytes are unknown', () => {
    expect(savingLine(analyzeImage(baseFacts({ format: 'jpeg', transferBytes: null })))).toBeNull();
  });

  it('labels a nonzero saving as an estimate', () => {
    const line = savingLine(analyzeImage(baseFacts({ format: 'jpeg', transferBytes: 400_000 })));
    expect(line).toMatch(/^est\. saving \d/);
  });

  it('reports a saving even when oversized is false (continuous estimate vs 1.5x gate)', () => {
    // naturalW just over the rendered size: below the 1.5x oversize gate, but the
    // legacy re-encode term still yields a nonzero estimate.
    const f = analyzeImage(baseFacts({ format: 'jpeg', naturalW: 900, displayW: 800, dpr: 1, transferBytes: 300_000 }));
    expect(f.oversized).toBe(false);
    expect(savingLine(f)).not.toBeNull();
  });
});

describe('sizeNoteLine', () => {
  it('is null while the size probe is still pending (unknown size, no terminal failure)', () => {
    expect(sizeNoteLine(analyzeImage(baseFacts({ transferBytes: null })))).toBeNull();
  });

  it('explains a cross-origin hidden size once the probe has failed', () => {
    const f = analyzeImage(baseFacts({ transferBytes: null, sizeUnavailable: true }));
    expect(sizeNoteLine(f)).toBe('size unavailable (cross-origin)');
  });

  it('is null when the size is known, even with a stale unavailable marker', () => {
    expect(sizeNoteLine(analyzeImage(baseFacts({ sizeUnavailable: true })))).toBeNull();
  });

  it('is null for data URIs (the inline data uri flag already explains them)', () => {
    const f = analyzeImage(
      baseFacts({ currentSrc: 'data:image/png;base64,AAAA', format: 'png', transferBytes: null, sizeUnavailable: true })
    );
    expect(sizeNoteLine(f)).toBeNull();
  });

  it('uses the generic wording for non-http schemes', () => {
    const f = analyzeImage(
      baseFacts({ currentSrc: 'blob:https://example.com/x', transferBytes: null, sizeUnavailable: true })
    );
    expect(sizeNoteLine(f)).toBe('size unavailable');
  });
});

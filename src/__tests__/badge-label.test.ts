import { buildBadgeLabel, buildPanelModel, hasWarning } from '../content/badge-label';
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

function model(overrides: Partial<AmbientImageFacts> = {}) {
  return buildPanelModel(analyzeImage(baseFacts(overrides)));
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

describe('buildPanelModel header', () => {
  it('carries the format token and formatted size', () => {
    const m = model({ format: 'jpeg', transferBytes: 412_000 });
    expect(m.format).toBe('jpeg');
    expect(m.size).toBe('412 KB');
  });

  it('falls back to "img" and a null size when unknown', () => {
    const m = model({ format: null, transferBytes: null });
    expect(m.format).toBe('img');
    expect(m.size).toBeNull();
  });

  it('marks the LCP element', () => {
    expect(model().isLcp).toBe(false);
    expect(model({ isLcp: true }).isLcp).toBe(true);
  });
});

describe('buildPanelModel status', () => {
  it('reports "no flags" in the win tone for a clean image', () => {
    expect(model().status).toEqual({ text: 'no flags', tone: 'win' });
  });

  it('counts a single flag in the singular', () => {
    expect(model({ loading: 'eager' }).status).toEqual({ text: '1 flag', tone: 'loss' });
  });

  it('counts multiple flags in the plural', () => {
    expect(model({ loading: 'eager', alt: null }).status).toEqual({ text: '2 flags', tone: 'loss' });
  });
});

describe('buildPanelModel facts', () => {
  it('reports natural and shown dimensions', () => {
    const m = model({ naturalW: 1600, naturalH: 1200, displayW: 400, displayH: 300 });
    expect(m.facts).toContainEqual({ label: 'natural', value: '1600×1200' });
    expect(m.facts).toContainEqual({ label: 'shown', value: '400×300' });
  });

  it('appends the device pixel ratio when it is not 1', () => {
    const m = model({ dpr: 2 });
    expect(m.facts).toContainEqual({ label: 'shown', value: '800×600 @2x' });
  });

  it('adds a "used" row only when the resource renders in several places', () => {
    expect(model().facts.some((f) => f.label === 'used')).toBe(false);
    expect(model({ displayContexts: 3 }).facts).toContainEqual({ label: 'used', value: '3 places' });
  });
});

describe('buildPanelModel flags', () => {
  it('is empty for a clean image', () => {
    expect(model().flags).toEqual([]);
  });

  it('lists oversized with its rounded factor and the legacy format token', () => {
    const m = model({ naturalW: 2000, displayW: 500, dpr: 1, format: 'jpeg' });
    expect(m.flags).toContain('oversized 4x');
    expect(m.flags).toContain('legacy jpeg');
  });

  it('reports a missing alt attribute', () => {
    expect(model({ alt: null }).flags).toContain('no alt text');
  });

  it('reports an empty alt attribute distinctly', () => {
    expect(model({ alt: '  ' }).flags).toContain('empty alt text');
  });

  it('contains no em dash', () => {
    const m = model({ loading: 'eager', format: 'png', alt: null });
    expect(m.flags.join('\n')).not.toContain('—');
  });
});

describe('buildPanelModel saving', () => {
  it('is null when no bytes are saved', () => {
    expect(model().saving).toBeNull();
  });

  it('is null when transfer bytes are unknown', () => {
    expect(model({ format: 'jpeg', transferBytes: null }).saving).toBeNull();
  });

  it('labels a nonzero saving as an estimate with a percent of the transfer', () => {
    expect(model({ format: 'jpeg', transferBytes: 400_000 }).saving).toMatch(/^est\. saving \d.* · \d+%$/);
  });

  it('reports a saving even when oversized is false (continuous estimate vs 1.5x gate)', () => {
    // naturalW just over the rendered size: below the 1.5x oversize gate, but the
    // legacy re-encode term still yields a nonzero estimate.
    const f = analyzeImage(baseFacts({ format: 'jpeg', naturalW: 900, displayW: 800, dpr: 1, transferBytes: 300_000 }));
    expect(f.oversized).toBe(false);
    expect(buildPanelModel(f).saving).not.toBeNull();
  });
});

describe('buildPanelModel size note', () => {
  it('is null while the size probe is still pending (unknown size, no terminal failure)', () => {
    expect(model({ transferBytes: null }).note).toBeNull();
  });

  it('explains a cross-origin hidden size once the probe has failed', () => {
    expect(model({ transferBytes: null, sizeUnavailable: true }).note).toBe('size unavailable (cross-origin)');
  });

  it('is null when the size is known, even with a stale unavailable marker', () => {
    expect(model({ sizeUnavailable: true }).note).toBeNull();
  });

  it('is null for data URIs (the inline data uri flag already explains them)', () => {
    const m = model({
      currentSrc: 'data:image/png;base64,AAAA',
      format: 'png',
      transferBytes: null,
      sizeUnavailable: true
    });
    expect(m.note).toBeNull();
  });

  it('uses the generic wording for non-http schemes', () => {
    const m = model({ currentSrc: 'blob:https://example.com/x', transferBytes: null, sizeUnavailable: true });
    expect(m.note).toBe('size unavailable');
  });
});

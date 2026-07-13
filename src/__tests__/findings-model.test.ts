import { buildFindingsCardModel, imageName } from '../popup/findings-model';
import { aggregate, analyzeImage } from '../shared/analyze';
import type { AmbientImageFacts, PageFindings } from '../shared/types';
import { describe, expect, it } from 'vitest';

function facts(overrides: Partial<AmbientImageFacts> = {}): AmbientImageFacts {
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
    transferBytes: 100_000,
    format: 'avif',
    isLcp: false,
    ...overrides
  };
}

function pageOf(...list: AmbientImageFacts[]): PageFindings {
  return aggregate(list.map(analyzeImage));
}

describe('imageName', () => {
  it('returns the decoded last path segment', () => {
    expect(imageName('https://x.test/photos/my%20hero.jpg?w=400')).toBe('my hero.jpg');
  });

  it('names data URIs generically', () => {
    expect(imageName('data:image/png;base64,AAAA')).toBe('inline image');
  });

  it('degrades gracefully on an unparseable url', () => {
    expect(imageName('::::')).toBe('image');
  });
});

describe('buildFindingsCardModel', () => {
  it('sums transfer bytes across resources and formats them', () => {
    const findings = pageOf(
      facts({ currentSrc: 'https://x.test/a.avif', transferBytes: 400_000 }),
      facts({ currentSrc: 'https://x.test/b.avif', transferBytes: 600_000 })
    );
    const model = buildFindingsCardModel({ hostname: 'x.test', findings, imageCount: 2 });
    expect(model.totalBytesText).toBe('1 MB');
    expect(model.imageCount).toBe(2);
  });

  it('always emits the four card flags in order', () => {
    const model = buildFindingsCardModel({ hostname: 'x.test', findings: pageOf(facts()), imageCount: 1 });
    expect(model.flags.map((f) => f.label)).toEqual(['oversized', 'missing alt', 'not lazy', 'legacy format']);
  });

  it('maps "missing alt" to altAbsent, not empty alt', () => {
    const findings = pageOf(
      facts({ currentSrc: 'https://x.test/a.avif', alt: null }),
      facts({ currentSrc: 'https://x.test/b.avif', alt: '' })
    );
    const model = buildFindingsCardModel({ hostname: 'x.test', findings, imageCount: 2 });
    expect(model.flags.find((f) => f.label === 'missing alt')?.count).toBe(1);
  });

  it('names the LCP image when one is marked', () => {
    const findings = pageOf(
      facts({ currentSrc: 'https://x.test/hero.jpg', isLcp: true, format: 'jpeg' }),
      facts({ currentSrc: 'https://x.test/other.avif' })
    );
    const model = buildFindingsCardModel({ hostname: 'x.test', findings, imageCount: 2 });
    expect(model.lcpImageName).toBe('hero.jpg');
  });

  it('leaves the LCP name null when nothing is marked', () => {
    const model = buildFindingsCardModel({ hostname: 'x.test', findings: pageOf(facts()), imageCount: 1 });
    expect(model.lcpImageName).toBeNull();
  });

  it('nulls the LCP saving text when the estimate rounds to zero', () => {
    const model = buildFindingsCardModel({ hostname: 'x.test', findings: pageOf(facts()), imageCount: 1 });
    expect(model.estLcpSavingText).toBeNull();
  });

  it('detects a competing CDN vendor', () => {
    const findings = pageOf(
      facts({ currentSrc: 'https://res.cloudinary.com/demo/image/upload/x.jpg', format: 'jpeg' })
    );
    const model = buildFindingsCardModel({ hostname: 'x.test', findings, imageCount: 1 });
    expect(model.cdnName).toBe('Cloudinary');
  });

  it('does not treat our own edge as a competing CDN', () => {
    const findings = pageOf(facts({ currentSrc: 'https://cdn.auraimage.ai/proj/w=400/hero.avif' }));
    const model = buildFindingsCardModel({ hostname: 'x.test', findings, imageCount: 1 });
    expect(model.cdnName).toBeNull();
  });

  it('survives an empty page without NaN or blanks', () => {
    const model = buildFindingsCardModel({ hostname: 'x.test', findings: pageOf(), imageCount: 0 });
    expect(model.totalBytesText).toBe('0 B');
    expect(model.wastefulBytesText).toBe('0 B');
    expect(model.estLcpSavingText).toBeNull();
    expect(model.flags.every((f) => f.count === 0)).toBe(true);
  });

  it('survives all-opaque images (null transfer bytes) without NaN', () => {
    const findings = pageOf(
      facts({ transferBytes: null }),
      facts({ currentSrc: 'https://x.test/b', transferBytes: null })
    );
    const model = buildFindingsCardModel({ hostname: 'x.test', findings, imageCount: 2 });
    expect(model.totalBytesText).toBe('0 B');
    expect(model.wastefulBytesText).toBe('0 B');
  });
});

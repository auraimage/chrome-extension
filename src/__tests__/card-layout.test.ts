import { CARD_CANVAS, colorFor, flagsSummary, fontFor, layoutCard, stackY } from '../popup/card-layout';
import type { FindingsCardModel } from '../popup/findings-model';
import { describe, expect, it } from 'vitest';

function model(overrides: Partial<FindingsCardModel> = {}): FindingsCardModel {
  return {
    hostname: 'example.com',
    imageCount: 12,
    totalBytesText: '3.4 MB',
    wastefulBytesText: '1.1 MB',
    estLcpSavingText: '0.4 s',
    lcpImageName: 'hero.jpg',
    flags: [
      { label: 'oversized', count: 3 },
      { label: 'missing alt', count: 2 },
      { label: 'not lazy', count: 5 },
      { label: 'legacy format', count: 7 }
    ],
    cdnName: 'Cloudinary',
    ...overrides
  };
}

describe('CARD_CANVAS constants', () => {
  it('is the standard 1200x630 social card', () => {
    expect(CARD_CANVAS.width).toBe(1200);
    expect(CARD_CANVAS.height).toBe(630);
  });

  it('uses no pure black or white (hue-260 discipline, as rgb)', () => {
    const values = Object.values(CARD_CANVAS.color);
    expect(values).not.toContain('rgb(0, 0, 0)');
    expect(values).not.toContain('rgb(255, 255, 255)');
    expect(values.every((v) => v.startsWith('rgb('))).toBe(true);
  });
});

describe('stackY', () => {
  it('spaces lines evenly from a start baseline', () => {
    expect(stackY(100, 50, 0)).toBe(100);
    expect(stackY(100, 50, 1)).toBe(150);
    expect(stackY(100, 50, 3)).toBe(250);
  });
});

describe('flagsSummary', () => {
  it('joins flags on one line with middots and no em dash', () => {
    const line = flagsSummary(model());
    expect(line).toContain('oversized 3');
    expect(line).toContain('legacy format 7');
    expect(line).toContain('·');
    expect(line).not.toContain('—');
  });
});

describe('fontFor / colorFor', () => {
  it('paints muted roles with the muted color and body roles with the foreground', () => {
    expect(colorFor('eyebrow')).toBe(CARD_CANVAS.color.muted);
    expect(colorFor('footer')).toBe(CARD_CANVAS.color.muted);
    expect(colorFor('title')).toBe(CARD_CANVAS.color.fg);
    expect(colorFor('stat')).toBe(CARD_CANVAS.color.fg);
  });

  it('returns a css font shorthand for every role', () => {
    for (const role of ['eyebrow', 'title', 'stat', 'statMuted', 'flags', 'cdn', 'footer'] as const) {
      expect(fontFor(role)).toMatch(/px /);
    }
  });
});

describe('layoutCard', () => {
  it('starts with the eyebrow then the hostname title', () => {
    const rows = layoutCard(model());
    expect(rows[0]).toMatchObject({ text: 'aura x-ray', role: 'eyebrow' });
    expect(rows[1]).toMatchObject({ text: 'example.com', role: 'title' });
  });

  it('keeps every row inside the canvas bounds', () => {
    const rows = layoutCard(model());
    for (const row of rows) {
      expect(row.x).toBeGreaterThanOrEqual(0);
      expect(row.x).toBeLessThanOrEqual(CARD_CANVAS.width);
      expect(row.y).toBeGreaterThan(0);
      expect(row.y).toBeLessThanOrEqual(CARD_CANVAS.height);
    }
  });

  it('stacks the title below the eyebrow and the stats below the title', () => {
    const rows = layoutCard(model());
    const eyebrow = rows.find((r) => r.role === 'eyebrow')!;
    const title = rows.find((r) => r.role === 'title')!;
    const firstStat = rows.find((r) => r.role === 'stat')!;
    expect(title.y).toBeGreaterThan(eyebrow.y);
    expect(firstStat.y).toBeGreaterThan(title.y);
  });

  it('keeps the last content row clear of the footer on the maximal card', () => {
    // model() is the maximal case: 4 stat lines (incl. est LCP + LCP image) plus
    // the CDN row. The last content baseline must sit >= 24px above the footer.
    const rows = layoutCard(model());
    const footerY = rows.find((r) => r.role === 'footer')!.y;
    const lastContentY = Math.max(...rows.filter((r) => r.role !== 'footer').map((r) => r.y));
    expect(footerY - lastContentY).toBeGreaterThanOrEqual(24);
  });

  it('pins both footer rows to the same bottom baseline, right-aligning the link', () => {
    const rows = layoutCard(model());
    const footers = rows.filter((r) => r.role === 'footer');
    expect(footers).toHaveLength(2);
    expect(footers[0]!.y).toBe(footers[1]!.y);
    const link = footers.find((r) => r.text === 'auraimage.com')!;
    expect(link.align).toBe('right');
  });

  it('omits the LCP and CDN rows when the model has none, keeping the footer', () => {
    const rows = layoutCard(model({ estLcpSavingText: null, lcpImageName: null, cdnName: null }));
    expect(rows.some((r) => r.role === 'cdn')).toBe(false);
    expect(rows.some((r) => r.text.includes('LCP image'))).toBe(false);
    expect(rows.filter((r) => r.role === 'footer')).toHaveLength(2);
  });
});

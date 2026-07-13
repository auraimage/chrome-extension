import { buildFindingsMarkdown } from '../popup/findings-markdown';
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

describe('buildFindingsMarkdown', () => {
  it('opens with a heading naming the host', () => {
    expect(buildFindingsMarkdown(model()).split('\n')[0]).toBe('## AuraImage X-Ray: example.com');
  });

  it('lists the core measurements', () => {
    const md = buildFindingsMarkdown(model());
    expect(md).toContain('- images: 12');
    expect(md).toContain('- total bytes: 3.4 MB');
    expect(md).toContain('- wasteful bytes (est): 1.1 MB');
    expect(md).toContain('- est. LCP saving: 0.4 s');
    expect(md).toContain('- LCP image: hero.jpg');
  });

  it('lists every flag under a Flags heading', () => {
    const md = buildFindingsMarkdown(model());
    expect(md).toContain('Flags');
    expect(md).toContain('- oversized: 3');
    expect(md).toContain('- legacy format: 7');
  });

  it('includes the competing-CDN line when present', () => {
    expect(buildFindingsMarkdown(model())).toContain(
      'Served via Cloudinary. AuraImage would ship it smaller, try it below.'
    );
  });

  it('omits the CDN line when no vendor is detected', () => {
    expect(buildFindingsMarkdown(model({ cdnName: null }))).not.toContain('Served via');
  });

  it('omits LCP lines when unknown', () => {
    const md = buildFindingsMarkdown(model({ estLcpSavingText: null, lcpImageName: null }));
    expect(md).not.toContain('LCP saving');
    expect(md).not.toContain('LCP image');
  });

  it('always ends with the footer tagline and link', () => {
    expect(buildFindingsMarkdown(model())).toContain('measured, not scored. https://auraimage.ai');
  });

  it('contains no em dash', () => {
    expect(buildFindingsMarkdown(model())).not.toContain('—');
  });
});

import { parseAuraImageUrl } from './aura-url';
import { describe, expect, it } from 'vitest';

describe('parseAuraImageUrl', () => {
  it('parses a URL with no transform segment', () => {
    expect(parseAuraImageUrl('https://cdn.auraimage.ai/acme/photos/hero.avif')).toEqual({
      project: 'acme',
      name: 'photos/hero'
    });
  });

  it('parses a URL with a transform segment and strips the extension', () => {
    expect(parseAuraImageUrl('https://cdn.auraimage.ai/acme/w=800,fit=cover/hero.webp')).toEqual({
      project: 'acme',
      name: 'hero'
    });
  });

  it('keeps a multi-segment name and an unknown suffix', () => {
    expect(parseAuraImageUrl('https://cdn.auraimage.ai/acme/w=400/gallery/city.skyline')).toEqual({
      project: 'acme',
      name: 'gallery/city.skyline'
    });
  });

  it('decodes percent-encoded segments', () => {
    expect(parseAuraImageUrl('https://cdn.auraimage.ai/acme/my%20folder/hero%20image')).toEqual({
      project: 'acme',
      name: 'my folder/hero image'
    });
  });

  it('returns null for a non-AuraImage host', () => {
    expect(parseAuraImageUrl('https://res.cloudinary.com/acme/image/upload/hero.jpg')).toBeNull();
  });

  it('returns null for a bare project with no image name', () => {
    expect(parseAuraImageUrl('https://cdn.auraimage.ai/acme')).toBeNull();
  });

  it('returns null when only a transform segment follows the project', () => {
    expect(parseAuraImageUrl('https://cdn.auraimage.ai/acme/w=800')).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(parseAuraImageUrl('not a url')).toBeNull();
  });
});

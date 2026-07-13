import { detectCdn } from '../shared/competitors';
import { describe, expect, it } from 'vitest';

describe('detectCdn — positive matches', () => {
  it.each([
    ['https://res.cloudinary.com/demo/image/upload/sample.jpg', 'cloudinary', 'Cloudinary'],
    ['https://res.cloudinary.com/demo/whatever.jpg', 'cloudinary', 'Cloudinary'],
    ['https://any.host.example/image/upload/v1/sample.jpg', 'cloudinary', 'Cloudinary'],
    ['https://myapp.imgix.net/photo.jpg?w=400', 'imgix', 'imgix'],
    ['https://imagedelivery.net/abc123/hero/public', 'cloudflare', 'Cloudflare Images'],
    ['https://example.com/cdn-cgi/image/width=800/photo.jpg', 'cloudflare', 'Cloudflare Images'],
    ['https://ik.imagekit.io/demo/tr:w-300/photo.jpg', 'imagekit', 'ImageKit'],
    ['https://myzone.b-cdn.net/photo.jpg', 'bunny', 'Bunny'],
    ['https://example.com/_next/image?url=%2Fhero.png&w=640&q=75', 'vercel', 'Next/Vercel'],
    ['https://cdn.auraimage.ai/my-project/w=800/hero.avif', 'auraimage', 'AuraImage']
  ])('detects %s as %s', (url, id, name) => {
    expect(detectCdn(url)).toEqual({ id, name });
  });

  it('matches path-based patterns on relative URLs', () => {
    expect(detectCdn('/_next/image?url=%2Fa.png&w=640&q=75')).toEqual({ id: 'vercel', name: 'Next/Vercel' });
    expect(detectCdn('/cdn-cgi/image/width=200/a.png')).toEqual({ id: 'cloudflare', name: 'Cloudflare Images' });
    expect(detectCdn('/image/upload/a.jpg')).toEqual({ id: 'cloudinary', name: 'Cloudinary' });
  });

  it('is host-case-insensitive', () => {
    expect(detectCdn('https://MyApp.IMGIX.net/photo.jpg')).toEqual({ id: 'imgix', name: 'imgix' });
  });
});

describe('detectCdn — negative cases', () => {
  it.each([
    'https://example.com/photo.jpg',
    'https://images.example.com/hero.png',
    'https://notimgix.net.evil.com/photo.jpg',
    'https://cdn.auraimage.io/hero.jpg',
    'https://b-cdn.net.evil.com/photo.jpg',
    'https://cloudinary.com.evil.com/image/x.jpg',
    'not a url at all',
    ''
  ])('returns null for %s', (url) => {
    expect(detectCdn(url)).toBeNull();
  });
});

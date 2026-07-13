import {
  MENU_DOWNLOAD_OFFLINE_ID,
  MENU_OPTIMIZE_ID,
  MENU_PARENT_ID,
  deriveFileName,
  menuActionFor
} from './context-menu';
import { describe, expect, it } from 'vitest';

describe('menuActionFor', () => {
  it('routes the optimize item', () => {
    expect(menuActionFor(MENU_OPTIMIZE_ID)).toBe('optimize');
  });

  it('routes the offline download item', () => {
    expect(menuActionFor(MENU_DOWNLOAD_OFFLINE_ID)).toBe('download-offline');
  });

  it('returns null for the parent header', () => {
    expect(menuActionFor(MENU_PARENT_ID)).toBeNull();
  });

  it('returns null for unknown or numeric ids', () => {
    expect(menuActionFor('something-else')).toBeNull();
    expect(menuActionFor(42)).toBeNull();
  });
});

describe('deriveFileName', () => {
  it('swaps a simple extension for the encoded one', () => {
    expect(deriveFileName('https://x.test/photo.jpg', 'webp')).toBe('photo.webp');
  });

  it('drops the querystring and hash', () => {
    expect(deriveFileName('https://x.test/a/b/photo.JPG?v=2&s=1#frag', 'webp')).toBe('photo.webp');
  });

  it('is codec-agnostic in the extension it appends', () => {
    expect(deriveFileName('https://x.test/photo.jpg', 'avif')).toBe('photo.avif');
  });

  it('appends when the source has no extension', () => {
    expect(deriveFileName('https://x.test/gallery/logo', 'webp')).toBe('logo.webp');
  });

  it('decodes percent-encoded names', () => {
    expect(deriveFileName('https://cdn.test/my%20photo.png', 'webp')).toBe('my photo.webp');
  });

  it('keeps interior dots, dropping only the last extension', () => {
    expect(deriveFileName('https://x.test/archive.tar.gz', 'webp')).toBe('archive.tar.webp');
  });

  it('uses the last non-empty segment when the URL ends in a slash', () => {
    expect(deriveFileName('https://x.test/gallery/', 'webp')).toBe('gallery.webp');
  });

  it('falls back to image when the path has no segment', () => {
    expect(deriveFileName('https://x.test/', 'webp')).toBe('image.webp');
  });

  it('falls back to image for data and blob URLs', () => {
    expect(deriveFileName('data:image/png;base64,iVBORw0KGgo=', 'webp')).toBe('image.webp');
    expect(deriveFileName('blob:https://x.test/2b3c-uuid', 'webp')).toBe('image.webp');
  });

  it('handles a bare relative filename', () => {
    expect(deriveFileName('photo.png', 'webp')).toBe('photo.webp');
  });
});

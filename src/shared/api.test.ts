import {
  DemoExhausted,
  EdgeUnavailable,
  NotConfigured,
  RateLimited,
  demoAlt,
  demoTransformBytes,
  demoTransformBytesUrl,
  demoTransformStats
} from './api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

// api.ts reads the edge base from browser.storage.sync via getEdgeBase. Pin it to
// the production base through the fake-browser storage override so the URL-grammar
// assertions stay deterministic regardless of the dev WXT_EDGE_BASE env default.
const EDGE_BASE = 'https://cdn.auraimage.ai';

beforeEach(async () => {
  fakeBrowser.reset();
  await fakeBrowser.storage.sync.set({ edgeBase: EDGE_BASE });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(response: Response): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

describe('demoTransformBytesUrl', () => {
  it('builds a bytes-mode transform URL with only the supplied params', async () => {
    const url = await demoTransformBytesUrl('https://x.test/a.jpg', { w: 240, h: 240, fit: 'face', fmt: 'webp' });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://cdn.auraimage.ai');
    expect(parsed.pathname).toBe('/v1/demo/transform');
    expect(parsed.searchParams.get('url')).toBe('https://x.test/a.jpg');
    expect(parsed.searchParams.get('w')).toBe('240');
    expect(parsed.searchParams.get('h')).toBe('240');
    expect(parsed.searchParams.get('fit')).toBe('face');
    expect(parsed.searchParams.get('fmt')).toBe('webp');
    expect(parsed.searchParams.get('mode')).toBe('bytes');
  });

  it('omits params that were not provided', async () => {
    const parsed = new URL(await demoTransformBytesUrl('https://x.test/a.jpg'));
    expect(parsed.searchParams.has('w')).toBe(false);
    expect(parsed.searchParams.has('fit')).toBe(false);
    expect(parsed.searchParams.get('mode')).toBe('bytes');
  });
});

describe('demoTransformStats', () => {
  it('returns the parsed stats JSON on 200', async () => {
    const stats = {
      sourceUrl: 'https://x.test/a.jpg',
      originalBytes: 4_200_000,
      originalFormat: 'jpeg',
      width: 3000,
      height: 2000,
      appliedWidth: 2048,
      avifBytes: 180_000,
      webpBytes: 240_000,
      blurhash: 'LEHV6nWB2yk8',
      savingsPercent: 96
    };
    mockFetch(new Response(JSON.stringify(stats), { status: 200 }));
    await expect(demoTransformStats('https://x.test/a.jpg')).resolves.toEqual(stats);
  });

  it('throws RateLimited on a plain 429', async () => {
    mockFetch(new Response(JSON.stringify({ message: 'slow down' }), { status: 429 }));
    await expect(demoTransformStats('https://x.test/a.jpg')).rejects.toBeInstanceOf(RateLimited);
  });

  it('throws DemoExhausted on a 429 carrying X-Aura-Demo-Exhausted', async () => {
    mockFetch(
      new Response(JSON.stringify({ message: 'demo limit reached' }), {
        status: 429,
        headers: { 'X-Aura-Demo-Exhausted': 'daily' }
      })
    );
    await expect(demoTransformStats('https://x.test/a.jpg')).rejects.toBeInstanceOf(DemoExhausted);
  });

  it('throws EdgeUnavailable (not NotConfigured) on a transform 503', async () => {
    mockFetch(new Response('', { status: 503 }));
    await expect(demoTransformStats('https://x.test/a.jpg')).rejects.toBeInstanceOf(EdgeUnavailable);
  });

  it('surfaces the origin message on a 400', async () => {
    mockFetch(new Response(JSON.stringify({ message: 'url must use https' }), { status: 400 }));
    await expect(demoTransformStats('http://x.test/a.jpg')).rejects.toThrow('url must use https');
  });

  it('propagates a fetch timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')));
    await expect(demoTransformStats('https://x.test/a.jpg')).rejects.toBeInstanceOf(DOMException);
  });
});

describe('demoTransformBytes', () => {
  it('base64-encodes the body and reads the size headers', async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    mockFetch(
      new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'image/avif',
          'X-Aura-Demo-Original-Bytes': '4200000',
          'X-Aura-Demo-Optimized-Bytes': '180000'
        }
      })
    );
    const payload = await demoTransformBytes('https://x.test/a.jpg', { fmt: 'avif' });
    expect(payload.contentType).toBe('image/avif');
    expect(payload.originalBytes).toBe(4_200_000);
    expect(payload.optimizedBytes).toBe(180_000);
    expect(payload.base64).toBe(btoa(String.fromCharCode(1, 2, 3, 4)));
  });

  it('maps the daily-exhausted 429 before touching the body', async () => {
    mockFetch(new Response('', { status: 429, headers: { 'X-Aura-Demo-Exhausted': 'daily' } }));
    await expect(demoTransformBytes('https://x.test/a.jpg', { fmt: 'avif' })).rejects.toBeInstanceOf(DemoExhausted);
  });
});

describe('demoAlt', () => {
  it('returns the alt text on 200', async () => {
    mockFetch(new Response(JSON.stringify({ alt: 'a red bicycle' }), { status: 200 }));
    await expect(demoAlt('https://x.test/a.jpg')).resolves.toBe('a red bicycle');
  });

  it('throws NotConfigured on 503', async () => {
    mockFetch(new Response(JSON.stringify({ message: 'alt generation not configured' }), { status: 503 }));
    await expect(demoAlt('https://x.test/a.jpg')).rejects.toBeInstanceOf(NotConfigured);
  });

  it('throws RateLimited on 429', async () => {
    mockFetch(new Response(JSON.stringify({ message: 'slow down' }), { status: 429 }));
    await expect(demoAlt('https://x.test/a.jpg')).rejects.toBeInstanceOf(RateLimited);
  });
});

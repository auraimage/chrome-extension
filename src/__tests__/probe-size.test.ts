import { PROBE_MAX_BYTES, probeSize } from '../background/probe-size';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** A fake Response streaming `chunks` through body.getReader(). */
function streamResponse(chunks: Uint8Array[], headers: Record<string, string> = {}): Response {
  let index = 0;
  return {
    ok: true,
    headers: new Headers(headers),
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }
      })
    }
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probeSize', () => {
  it('sums the streamed body bytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamResponse([new Uint8Array(1_000), new Uint8Array(500)]))
    );
    await expect(probeSize('https://x.example.com/img.png')).resolves.toEqual({ bytes: 1_500 });
  });

  it('rejects a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response)
    );
    await expect(probeSize('https://x.example.com/gone.png')).rejects.toThrow('status 404');
  });

  it('rejects a declared oversized body without reading it', async () => {
    const response = streamResponse([new Uint8Array(10)], { 'content-length': String(PROBE_MAX_BYTES + 1) });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    await expect(probeSize('https://x.example.com/huge.png')).rejects.toThrow('too large');
  });

  it('aborts mid-stream once the body exceeds the ceiling', async () => {
    // An endless stream of 4 MB chunks: without the running-total abort this
    // test would never finish.
    const endless = {
      ok: true,
      headers: new Headers(),
      body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(4 * 1024 * 1024) }) }) }
    } as unknown as Response;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => endless)
    );
    await expect(probeSize('https://x.example.com/endless.png')).rejects.toThrow('too large');
  });
});

import type * as sizeProbe from '../content/size-probe';
import type { ProbeOutcome } from '../content/size-probe';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ProbeModule = typeof sizeProbe;

// Each test imports a fresh module instance: the probe memoizes outcomes for
// the page's lifetime, and vi.resetModules() is that page reload.
async function freshModule(): Promise<ProbeModule> {
  vi.resetModules();
  return import('../content/size-probe');
}

type SendMessage = (message: unknown, callback: (response?: unknown) => void) => void;

function stubChrome(sendMessage: SendMessage): ReturnType<typeof vi.fn> {
  const mock = vi.fn(sendMessage);
  vi.stubGlobal('chrome', { runtime: { sendMessage: mock, lastError: undefined } });
  return mock;
}

/** A minimal ok fetch Response whose blob reports `size` bytes. */
function okResponse(size: number): Response {
  return { ok: true, blob: async () => ({ size }) } as unknown as Response;
}

async function settled(probe: ProbeModule, url: string): Promise<ProbeOutcome> {
  return vi.waitFor(() => {
    const outcome = probe.probeOutcome(url);
    expect(outcome).toBeDefined();
    return outcome as ProbeOutcome;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('queueSizeProbes', () => {
  it('measures via the in-page fetch and memoizes the outcome', async () => {
    const probe = await freshModule();
    const fetchMock = vi.fn(async () => okResponse(2_300));
    vi.stubGlobal('fetch', fetchMock);
    const sendMessage = stubChrome(vi.fn());
    const onSettled = vi.fn();

    probe.queueSizeProbes(['https://cdn.example.com/a.png'], onSettled);
    expect(await settled(probe, 'https://cdn.example.com/a.png')).toEqual({ bytes: 2_300 });
    expect(sendMessage).not.toHaveBeenCalled();

    // A second queue for the same URL must not probe again.
    probe.queueSizeProbes(['https://cdn.example.com/a.png'], onSettled);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('falls back to the background when the page fetch cannot read the response', async () => {
    const probe = await freshModule();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('CORS blocked');
      })
    );
    stubChrome((message, callback) => {
      expect(message).toEqual({ type: 'aura:probe-size', src: 'https://other.example.com/b.png' });
      callback({ ok: true, value: { bytes: 41_000 } });
    });

    probe.queueSizeProbes(['https://other.example.com/b.png'], vi.fn());
    expect(await settled(probe, 'https://other.example.com/b.png')).toEqual({ bytes: 41_000 });
  });

  it('settles non-http(s) sources as unavailable without fetching', async () => {
    const probe = await freshModule();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    stubChrome(vi.fn());

    probe.queueSizeProbes(['blob:https://example.com/0f1e'], vi.fn());
    expect(probe.probeOutcome('blob:https://example.com/0f1e')).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up as unavailable when both attempts fail', async () => {
    const probe = await freshModule();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('CORS blocked');
      })
    );
    stubChrome((_message, callback) => callback({ ok: false, error: 'network', message: 'nope' }));

    probe.queueSizeProbes(['https://other.example.com/c.png'], vi.fn());
    expect(await settled(probe, 'https://other.example.com/c.png')).toBe('unavailable');
  });

  it('stops background downloads at the per-page cap', async () => {
    const probe = await freshModule();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('CORS blocked');
      })
    );
    const sendMessage = stubChrome((_message, callback) => callback({ ok: true, value: { bytes: 5 } }));

    const urls = Array.from({ length: probe.MAX_BACKGROUND_PROBES + 2 }, (_, i) => `https://x.example.com/${i}.png`);
    probe.queueSizeProbes(urls, vi.fn());
    const outcomes = await Promise.all(urls.map((url) => settled(probe, url)));

    expect(sendMessage).toHaveBeenCalledTimes(probe.MAX_BACKGROUND_PROBES);
    expect(outcomes.filter((o) => o === 'unavailable')).toHaveLength(2);
    expect(outcomes.filter((o) => typeof o === 'object')).toHaveLength(probe.MAX_BACKGROUND_PROBES);
  });
});

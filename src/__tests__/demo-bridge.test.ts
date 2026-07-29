import { requestAlt, requestBytes, requestStats } from '../content/demo-bridge';
import type { DemoResult, DemoStats } from '../shared/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';

// demo-bridge sends every edge request to the background over runtime.sendMessage
// in PROMISE form. These tests mock sendMessage as promise-returning and ignoring
// any callback — exactly how Firefox's native `browser` behaves. So a regression
// back to callback style, where the reply never arrives, would hang and fail here
// rather than pass silently on Chrome's callback semantics.
function stubReply(reply: (message: unknown) => unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (message: unknown) => reply(message));
  vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(mock as never);
  return mock;
}

const STATS: DemoStats = {
  sourceUrl: 'https://cdn.example.com/a.png',
  originalBytes: 100_000,
  originalFormat: 'png',
  width: 800,
  height: 600,
  appliedWidth: 800,
  avifBytes: 20_000,
  webpBytes: 30_000,
  blurhash: 'LEHV6nWB2yk8',
  savingsPercent: 80
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('demo-bridge', () => {
  it('resolves requestStats with the background reply', async () => {
    const reply: DemoResult<DemoStats> = { ok: true, value: STATS };
    const send = stubReply((message) => {
      expect(message).toMatchObject({ type: 'aura:demo-stats', src: 'https://cdn.example.com/a.png' });
      return reply;
    });

    await expect(requestStats('https://cdn.example.com/a.png')).resolves.toEqual(reply);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('maps a missing reply to a network error', async () => {
    stubReply(() => undefined);

    await expect(requestAlt('https://cdn.example.com/a.png')).resolves.toEqual({
      ok: false,
      error: 'network',
      message: 'no response from background'
    });
  });

  it('maps a rejected send (no receiver) to a network error', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.') as never
    );

    await expect(requestBytes('https://cdn.example.com/a.png', { fmt: 'avif' })).resolves.toEqual({
      ok: false,
      error: 'network',
      message: 'Could not establish connection. Receiving end does not exist.'
    });
  });
});

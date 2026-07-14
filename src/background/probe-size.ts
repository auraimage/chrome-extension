// Background half of the Size probe (ADR 0026): fetch an image the page
// already loaded and return its byte size. The worker's cache partition is
// separate from the page's, so this is a real download — the content script
// rations calls (MAX_BACKGROUND_PROBES per page) and this side enforces the
// byte ceiling, aborting oversized bodies mid-stream instead of downloading
// them whole. No chrome.* usage so it unit-tests in plain node.

const PROBE_TIMEOUT_MS = 8_000;
export const PROBE_MAX_BYTES = 10 * 1024 * 1024;

/** Fetch `src` and count its body bytes; throws on error, timeout, or oversize. */
export async function probeSize(src: string): Promise<{ bytes: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(src, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error(`probe failed with status ${response.status}`);

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > PROBE_MAX_BYTES) {
      controller.abort();
      throw new Error('probe body too large');
    }

    if (!response.body) {
      const blob = await response.blob();
      if (blob.size > PROBE_MAX_BYTES) throw new Error('probe body too large');
      return { bytes: blob.size };
    }

    const reader = response.body.getReader();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > PROBE_MAX_BYTES) {
        controller.abort();
        throw new Error('probe body too large');
      }
    }
    return { bytes };
  } finally {
    clearTimeout(timer);
  }
}

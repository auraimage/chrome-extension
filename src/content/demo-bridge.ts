// Thin promise wrappers around the background edge proxy, plus the byte helpers
// the optimize panel needs. Content scripts can't fetch the edge directly (page
// CORS/CSP), so every call is a browser.runtime round-trip; the background does
// the fetch and returns JSON stats, alt text, or base64 image bytes.
import type { DemoBytesPayload, DemoResult, DemoStats, DemoTransformOpts } from '../shared/types';
import { browser } from 'wxt/browser';

function send<T>(message: unknown): Promise<DemoResult<T>> {
  return new Promise((resolve) => {
    browser.runtime.sendMessage(message, (response?: DemoResult<T>) => {
      const error = browser.runtime.lastError;
      if (error || !response) {
        resolve({ ok: false, error: 'network', message: error?.message ?? 'no response from background' });
        return;
      }
      resolve(response);
    });
  });
}

export function requestStats(src: string, opts?: DemoTransformOpts): Promise<DemoResult<DemoStats>> {
  return send<DemoStats>({ type: 'aura:demo-stats', src, opts });
}

export function requestBytes(src: string, opts: DemoTransformOpts): Promise<DemoResult<DemoBytesPayload>> {
  return send<DemoBytesPayload>({ type: 'aura:demo-bytes', src, opts });
}

export function requestAlt(src: string): Promise<DemoResult<{ alt: string }>> {
  return send<{ alt: string }>({ type: 'aura:demo-alt', src });
}

/** Rebuild a Blob from the base64 body marshaled back over messaging. */
export function payloadToBlob(payload: DemoBytesPayload): Blob {
  const binary = atob(payload.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: payload.contentType });
}

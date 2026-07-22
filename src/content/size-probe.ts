// Size probe (ADR 0026): recovers an image's real byte size when Resource
// Timing hides it (cross-origin without Timing-Allow-Origin, evicted entries).
// An in-page fetch runs first — it shares the page's HTTP-cache partition, so
// it is normally a cache hit with zero network, but page CORS must allow the
// read. The fallback is a background fetch: the service worker bypasses CORS
// via host permissions, but its cache partition is separate from the page's,
// so every fallback is a real download and is rationed by MAX_BACKGROUND_PROBES.
// Outcomes (success AND failure) are memoized per URL for the page's lifetime:
// the ambient pass re-collects on every DOM mutation and must never probe the
// same URL twice. Probes go only to hosts the page already loaded images from;
// nothing here talks to the AuraImage edge.
import type { DemoResult, SizeProbeRequest } from '../shared/types';
import { browser } from 'wxt/browser';

export const PROBE_TIMEOUT_MS = 8_000;
/** Hard ceiling on background (real-network) probe downloads per page. */
export const MAX_BACKGROUND_PROBES = 10;
/** Background probes in flight at once. */
const BACKGROUND_CONCURRENCY = 3;

/** A terminal probe result: the measured bytes, or a definitive "cannot know". */
export type ProbeOutcome = { bytes: number } | 'unavailable';

const outcomes = new Map<string, ProbeOutcome>();
const pending = new Set<string>();
let backgroundBudget = MAX_BACKGROUND_PROBES;

/** The memoized outcome for a URL, or undefined while unprobed/pending. */
export function probeOutcome(url: string): ProbeOutcome | undefined {
  return outcomes.get(url);
}

/**
 * Start probes for any URL not already probed or in flight. `onSettled` fires
 * after each terminal outcome so the caller can re-render badges; non-http(s)
 * schemes settle synchronously as 'unavailable' without firing it (the next
 * natural re-collect picks them up).
 */
export function queueSizeProbes(urls: string[], onSettled: () => void): void {
  for (const url of urls) {
    if (outcomes.has(url) || pending.has(url)) continue;
    if (!/^https?:/i.test(url)) {
      outcomes.set(url, 'unavailable');
      continue;
    }
    pending.add(url);
    void probe(url).then((outcome) => {
      pending.delete(url);
      outcomes.set(url, outcome);
      onSettled();
    });
  }
}

async function probe(url: string): Promise<ProbeOutcome> {
  const local = await fetchSizeInPage(url);
  if (local !== null) return { bytes: local };
  if (backgroundBudget <= 0) return 'unavailable';
  backgroundBudget--;
  const remote = await withBackgroundSlot(() => fetchSizeViaBackground(url));
  return remote !== null ? { bytes: remote } : 'unavailable';
}

/**
 * In-page attempt. force-cache prefers the copy the page's <img> already
 * downloaded; credentials are omitted so the probe never replays cookies.
 * Returns null when CORS blocks the read, the response fails, or it times out.
 */
async function fetchSizeInPage(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'force-cache',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size > 0 ? blob.size : null;
  } catch {
    return null;
  }
}

/** Background fallback: one message per probe; any error resolves to null. */
function fetchSizeViaBackground(url: string): Promise<number | null> {
  const message: SizeProbeRequest = { type: 'aura:probe-size', src: url };
  return new Promise((resolve) => {
    browser.runtime.sendMessage(message, (response?: DemoResult<{ bytes: number }>) => {
      const error = browser.runtime.lastError;
      if (error || !response?.ok) {
        resolve(null);
        return;
      }
      resolve(response.value.bytes > 0 ? response.value.bytes : null);
    });
  });
}

let backgroundActive = 0;
const backgroundWaiters: Array<() => void> = [];

/** Tiny semaphore so at most {@link BACKGROUND_CONCURRENCY} downloads overlap. */
async function withBackgroundSlot<T>(work: () => Promise<T>): Promise<T> {
  if (backgroundActive >= BACKGROUND_CONCURRENCY) {
    await new Promise<void>((release) => backgroundWaiters.push(release));
  }
  backgroundActive++;
  try {
    return await work();
  } finally {
    backgroundActive--;
    backgroundWaiters.shift()?.();
  }
}

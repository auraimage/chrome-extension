// Edge client for the AuraImage Demo surface (ADR 0024). Runs in the background
// service worker, which has host_permissions and is therefore not subject to the
// page's CORS/CSP; content and popup reach it via chrome.runtime messages. Every
// call is bounded by a 15s timeout and maps the edge's status codes to typed
// errors the callers can branch on.
import { getEdgeBase } from './config';
import type { DemoBytesPayload, DemoStats, DemoTransformOpts } from './types';

const TIMEOUT_MS = 15_000;

/** Transient per-IP rate limit (plain 429). Retrying shortly may succeed. */
export class RateLimited extends Error {
  constructor(message = 'demo rate limit, retry in a minute') {
    super(message);
    this.name = 'RateLimited';
  }
}

/** The shared daily demo ceiling is spent (429 + X-Aura-Demo-Exhausted). */
export class DemoExhausted extends Error {
  constructor(message = 'demo limit reached') {
    super(message);
    this.name = 'DemoExhausted';
  }
}

/** Alt generation is not configured on this edge (503 on the alt route). */
export class NotConfigured extends Error {
  constructor(message = 'alt generation not configured') {
    super(message);
    this.name = 'NotConfigured';
  }
}

/** Transient 503 on a transform path: the demo edge is briefly unavailable. */
export class EdgeUnavailable extends Error {
  constructor(message = 'the demo edge is briefly unavailable, try again') {
    super(message);
    this.name = 'EdgeUnavailable';
  }
}

async function buildTransformUrl(url: string, opts: DemoTransformOpts, mode: 'stats' | 'bytes'): Promise<string> {
  const target = new URL('/v1/demo/transform', await getEdgeBase());
  target.searchParams.set('url', url);
  if (opts.w !== undefined) target.searchParams.set('w', String(opts.w));
  if (opts.h !== undefined) target.searchParams.set('h', String(opts.h));
  if (opts.fit !== undefined) target.searchParams.set('fit', opts.fit);
  if (opts.fmt !== undefined) target.searchParams.set('fmt', opts.fmt);
  target.searchParams.set('mode', mode);
  return target.toString();
}

/**
 * Build the `mode=bytes` GET URL without fetching. Kept as a pure builder so the
 * URL grammar is unit-testable; {@link demoTransformBytes} does the actual fetch.
 */
export function demoTransformBytesUrl(url: string, opts: DemoTransformOpts = {}): Promise<string> {
  return buildTransformUrl(url, opts, 'bytes');
}

/**
 * Throw the typed error for a non-2xx edge response. Reads headers first. Only
 * the alt route treats a 503 as "not configured" (its vision key is optional);
 * on the transform paths a 503 is a transient edge outage, not a config gap.
 */
async function raiseForStatus(res: Response, altRoute = false): Promise<never> {
  if (res.status === 429) {
    if (res.headers.get('X-Aura-Demo-Exhausted')) throw new DemoExhausted();
    throw new RateLimited();
  }
  if (res.status === 503) throw altRoute ? new NotConfigured() : new EdgeUnavailable();
  const message = await res
    .clone()
    .json()
    .then((body: { message?: string }) => body.message)
    .catch(() => undefined);
  throw new Error(message ?? `demo request failed (${res.status})`);
}

export async function demoTransformStats(url: string, opts: DemoTransformOpts = {}): Promise<DemoStats> {
  const res = await fetch(await buildTransformUrl(url, opts, 'stats'), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) await raiseForStatus(res);
  return (await res.json()) as DemoStats;
}

export async function demoTransformBytes(url: string, opts: DemoTransformOpts = {}): Promise<DemoBytesPayload> {
  const res = await fetch(await buildTransformUrl(url, opts, 'bytes'), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) await raiseForStatus(res);
  const base64 = toBase64(new Uint8Array(await res.arrayBuffer()));
  return {
    base64,
    contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
    originalBytes: numHeader(res, 'X-Aura-Demo-Original-Bytes'),
    optimizedBytes: numHeader(res, 'X-Aura-Demo-Optimized-Bytes')
  };
}

export async function demoAlt(url: string): Promise<string> {
  const target = new URL('/v1/demo/alt', await getEdgeBase());
  target.searchParams.set('url', url);
  const res = await fetch(target.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) await raiseForStatus(res, true);
  const body = (await res.json()) as { alt?: string };
  return body.alt ?? '';
}

function numHeader(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Chunked btoa: base64 an arbitrary byte array without a huge apply() stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

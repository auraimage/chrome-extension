// Ambient fact collection from the live DOM. 100% client-side: it reads element
// geometry, attributes, and the Resource Timing / LCP performance entries the
// browser already recorded. It makes NO network calls to the AuraImage edge.
// Duplicate uses of one currentSrc are folded into a single facts object (with a
// displayContexts count) so the Task 4 analysis sees one entry per resource,
// while the overlay still gets every rendered element to badge.
import type { AmbientImageFacts } from '../shared/types';

export interface CollectedImage {
  facts: AmbientImageFacts;
  /** Every rendered <img> element sharing this resource (one badge each). */
  elements: HTMLImageElement[];
}

const KNOWN_FORMATS = new Set(['jpeg', 'jpg', 'png', 'gif', 'webp', 'avif', 'svg']);

// The element the browser reported as the Largest Contentful Paint. Updated by
// the observer below; read during collection to mark the matching image.
let lcpElement: Element | null = null;

/**
 * Start observing LCP. The browser buffers the entry, so this catches paints
 * that happened before the content script ran. `onUpdate` lets the caller
 * re-collect once the LCP element is known.
 */
export function startLcpObserver(onUpdate: () => void): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as (PerformanceEntry & { element?: Element }) | undefined;
      if (last?.element) {
        lcpElement = last.element;
        onUpdate();
      }
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    // largest-contentful-paint unsupported: LCP marking is simply skipped.
  }
}

/** Map every recorded resource URL to its timing entry (first occurrence wins). */
function resourceTimingByUrl(): Map<string, PerformanceResourceTiming> {
  const byUrl = new Map<string, PerformanceResourceTiming>();
  for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    if (!byUrl.has(entry.name)) byUrl.set(entry.name, entry);
  }
  return byUrl;
}

/**
 * Transfer bytes for a resource, or null when unknown. Cross-origin responses
 * without Timing-Allow-Origin expose zeros for every size field, so a zero
 * encoded/transfer size is treated as "unknown" rather than "free".
 */
function resolveTransferBytes(entry: PerformanceResourceTiming | undefined): number | null {
  if (!entry) return null;
  if (entry.encodedBodySize > 0) return entry.encodedBodySize;
  if (entry.transferSize > 0) return entry.transferSize;
  return null;
}

/** Best-effort format token from a URL: extension, or `data:image/<fmt>` mime. */
function formatFromUrl(url: string): string | null {
  if (url.startsWith('data:')) {
    const mime = /^data:image\/([a-z0-9.+-]+)/i.exec(url)?.[1]?.toLowerCase();
    if (!mime) return null;
    return mime.startsWith('svg') ? 'svg' : mime;
  }
  let pathname: string;
  try {
    pathname = new URL(url, location.href).pathname;
  } catch {
    return null;
  }
  const segment = pathname.split('/').pop() ?? '';
  const dot = segment.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = segment.slice(dot + 1).toLowerCase();
  return KNOWN_FORMATS.has(ext) ? ext : null;
}

/** True when the img (or its enclosing <picture>) declares any srcset. */
function hasSrcset(img: HTMLImageElement): boolean {
  if (img.getAttribute('srcset')) return true;
  const picture = img.closest('picture');
  if (!picture) return false;
  return Array.from(picture.querySelectorAll('source')).some((source) => source.getAttribute('srcset'));
}

interface RawImage {
  el: HTMLImageElement;
  facts: AmbientImageFacts;
}

/** Gather one raw record per <img> element that has actually loaded a resource. */
function collectRaw(timing: Map<string, PerformanceResourceTiming>): RawImage[] {
  const raw: RawImage[] = [];
  for (const el of Array.from(document.images)) {
    const currentSrc = el.currentSrc || el.src;
    if (!currentSrc) continue; // not yet resolved; a later re-collect will catch it
    const rect = el.getBoundingClientRect();
    raw.push({
      el,
      facts: {
        currentSrc,
        naturalW: el.naturalWidth,
        naturalH: el.naturalHeight,
        displayW: Math.round(rect.width),
        displayH: Math.round(rect.height),
        dpr: window.devicePixelRatio || 1,
        alt: el.getAttribute('alt'),
        loading: el.loading,
        hasSrcset: hasSrcset(el),
        transferBytes: resolveTransferBytes(timing.get(currentSrc)),
        format: formatFromUrl(currentSrc),
        isLcp: el === lcpElement
      }
    });
  }
  return raw;
}

/**
 * Collect page image facts, folding duplicate uses of one currentSrc into a
 * single {@link AmbientImageFacts}. The representative is the largest-rendered
 * instance (so a shared source is not falsely flagged oversized when some
 * context legitimately needs full size), and `displayContexts` counts the
 * distinct render sizes (the signal that a missing srcset actually matters).
 */
export function collectFacts(): CollectedImage[] {
  const timing = resourceTimingByUrl();
  const groups = new Map<string, RawImage[]>();
  for (const item of collectRaw(timing)) {
    const group = groups.get(item.facts.currentSrc);
    if (group) group.push(item);
    else groups.set(item.facts.currentSrc, [item]);
  }

  const collected: CollectedImage[] = [];
  for (const group of groups.values()) {
    const representative = group.reduce((widest, candidate) =>
      candidate.facts.displayW > widest.facts.displayW ? candidate : widest
    );
    const distinctSizes = new Set(group.map((g) => `${g.facts.displayW}x${g.facts.displayH}`)).size;
    collected.push({
      facts: {
        ...representative.facts,
        isLcp: group.some((g) => g.facts.isLcp),
        displayContexts: distinctSizes
      },
      elements: group.map((g) => g.el)
    });
  }
  return collected;
}

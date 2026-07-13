// Messaging protocol and data contracts shared across the extension surfaces.
// Defined now so later tasks (ambient pass, overlay, edge actions) build against
// a stable shape. Keep minimal; later tasks extend.

/**
 * Client-side static facts about a single image on the page. Gathered by the
 * ambient pass (Task 4) with zero network calls.
 */
export interface AmbientImageFacts {
  currentSrc: string;
  naturalW: number;
  naturalH: number;
  displayW: number;
  displayH: number;
  dpr: number;
  alt: string | null;
  loading: string;
  hasSrcset: boolean;
  transferBytes: number | null;
  format: string | null;
  isLcp: boolean;
  /**
   * How many distinct on-page render sizes share this image resource. The DOM
   * pass folds duplicate uses of one `currentSrc` into a single facts object
   * and records the count here; a lone `<img>` is `1`. Optional so existing
   * single-context construction sites need not set it (defaults to 1).
   */
  displayContexts?: number;
}

/**
 * Per-image analysis result: the source facts plus the boolean flags and byte
 * estimate derived by {@link analyzeImage}. Deliberately carries no composite
 * score/grade/health (ADR 0015) — only facts, flags, and estimates.
 */
export interface ImageFindings {
  facts: AmbientImageFacts;
  /** Served format is jpeg/jpg/png/gif (no modern format won negotiation). */
  legacyFormat: boolean;
  /** naturalW exceeds displayW * dpr * 1.5. */
  oversized: boolean;
  /** naturalW / (displayW * dpr); 0 when the render size is unknown. */
  oversizeFactor: number;
  /** `alt` attribute is absent (null). */
  altAbsent: boolean;
  /** `alt` attribute is present but empty after trimming. */
  altEmpty: boolean;
  /** `loading` is not "lazy". */
  missingLazy: boolean;
  /** No srcset while it would help (oversized or >1 display context). */
  missingSrcset: boolean;
  /** The resource is an inline `data:` URI. */
  dataUri: boolean;
  /**
   * Estimated transfer bytes saved by optimizing this image, or null when
   * transferBytes is unknown (cross-origin without Timing-Allow-Origin).
   */
  estSavedBytes: number | null;
}

/** Per-flag image counts across a page. */
export interface FindingCounts {
  legacyFormat: number;
  oversized: number;
  altAbsent: number;
  altEmpty: number;
  missingLazy: number;
  missingSrcset: number;
  dataUri: number;
}

/**
 * Aggregate, page-level findings produced by {@link aggregate}. Counts, bytes,
 * and estimates only — no composite score (ADR 0015). Includes the per-image
 * findings so the overlay/popup can render detail from a single message.
 */
export interface PageFindings {
  images: ImageFindings[];
  totalImages: number;
  counts: FindingCounts;
  /** Sum of per-image estSavedBytes (null estimates treated as 0). */
  wastefulBytes: number;
  /** Estimated LCP time saved, in seconds, from shipping wastefulBytes fewer bytes. */
  estLcpSavingSeconds: number;
}

/** Content script to popup/background: the ambient findings for this page. */
export interface PageFindingsMessage {
  type: 'aura:page-findings';
  findings: PageFindings;
}

/** Popup to content script: ask the active tab for its ambient findings. */
export interface GetFindingsMessage {
  type: 'aura:get-findings';
}

/**
 * The content script's reply to {@link GetFindingsMessage}. Carries the folded
 * per-resource findings plus the page URL and the count of rendered `<img>`
 * elements (which can exceed `findings.totalImages` when one resource is reused
 * across several imgs, so the popup headline stays consistent with the badges).
 */
export interface FindingsResponse {
  findings: PageFindings;
  pageUrl: string;
  renderedImageCount: number;
}

/** Popup/background to content script: show or hide the inline overlay. */
export interface ToggleOverlayMessage {
  type: 'aura:toggle-overlay';
}

/** Transform knobs shared by the stats and bytes edge calls. */
export interface DemoTransformOpts {
  w?: number;
  h?: number;
  fit?: 'cover' | 'contain' | 'face' | 'auto';
  fmt?: 'avif' | 'webp' | 'jpeg';
}

/** Shape of the `mode=stats` JSON from `/v1/demo/transform` (see apps/cdn-origin). */
export interface DemoStats {
  sourceUrl: string;
  originalBytes: number;
  originalFormat: string;
  width: number;
  height: number;
  appliedWidth: number;
  avifBytes: number;
  webpBytes: number;
  blurhash: string;
  savingsPercent: number;
}

/** Optimized bytes plus the origin/optimized sizes, marshaled over messaging. */
export interface DemoBytesPayload {
  /** base64 of the optimized image body (ArrayBuffers don't survive sendMessage). */
  base64: string;
  contentType: string;
  originalBytes: number | null;
  optimizedBytes: number | null;
}

/**
 * Why an edge call failed, in a form the content/popup UI can branch on.
 * `rate-limited` and `exhausted` both map to a 429; `exhausted` is the daily
 * ceiling (inline wall) while `rate-limited` is the transient per-IP limit.
 * `edge-unavailable` is a transient 503 on a transform path (retryable);
 * `not-configured` is a 503 on the alt route only (its vision key is optional).
 */
export type DemoErrorKind =
  'rate-limited' | 'exhausted' | 'not-configured' | 'edge-unavailable' | 'timeout' | 'network' | 'invalid';

/** Discriminated result the background returns for every edge message. */
export type DemoResult<T> = { ok: true; value: T } | { ok: false; error: DemoErrorKind; message: string };

/** Content/popup to background: run `/v1/demo/transform?mode=stats`. */
export interface DemoStatsRequest {
  type: 'aura:demo-stats';
  src: string;
  opts?: DemoTransformOpts;
}

/** Content/popup to background: fetch optimized bytes (`mode=bytes`). */
export interface DemoBytesRequest {
  type: 'aura:demo-bytes';
  src: string;
  opts: DemoTransformOpts;
}

/** Content/popup to background: ask the edge for AI alt text. */
export interface DemoAltRequest {
  type: 'aura:demo-alt';
  src: string;
}

/** Background (context menu) to content script: open the optimize panel for an image. */
export interface OpenOptimizeMessage {
  type: 'aura:open-optimize';
  src: string;
}

/**
 * Background to content script: trigger a blob-URL anchor download of the
 * offline-encoded bytes. The content script owns the download so we avoid the
 * `downloads` permission (and its install warning). base64 because ArrayBuffers
 * do not survive sendMessage.
 */
export interface OfflineDownloadMessage {
  type: 'aura:offline-download';
  base64: string;
  contentType: string;
  fileName: string;
}

/**
 * Background to content script: show a transient notice in the overlay. Used for
 * the export gate (with the create-a-free-project CTA) and for a quiet failure
 * when an image cannot be compressed offline.
 */
export interface OfflineNoticeMessage {
  type: 'aura:offline-notice';
  text: string;
  ctaHref?: string;
}

export type AuraMessage =
  | PageFindingsMessage
  | GetFindingsMessage
  | ToggleOverlayMessage
  | DemoStatsRequest
  | DemoBytesRequest
  | DemoAltRequest
  | OpenOptimizeMessage
  | OfflineDownloadMessage
  | OfflineNoticeMessage;

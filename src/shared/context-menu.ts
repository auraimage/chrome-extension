// Context-menu wiring for the "AuraImage" image menu (Task 7). The menu ids,
// the offline codec title, the id -> action routing, and the download filename
// derivation are pure and unit-tested here; the background worker owns the
// chrome.contextMenus side effects and the content script owns the download.
//
// The offline codec is a swappable tail: to move from WebP to AVIF, change
// OFFLINE_MENU_TITLE here and the encoder in background/offline-encode.ts. Menu
// routing, filenames, the gate, and the download path are codec-agnostic.

/** Root menu id; a header only, never actioned. */
export const MENU_PARENT_ID = 'aura-parent';
/** "Optimize this image": opens the Task 6 panel for the clicked image. */
export const MENU_OPTIMIZE_ID = 'aura-optimize';
/** Offline compress + download; title reflects the shipped codec. */
export const MENU_DOWNLOAD_OFFLINE_ID = 'aura-download-offline';

/** Title of the offline item. WebP is the shipped codec (see module note). */
export const OFFLINE_MENU_TITLE = 'Download as WebP (offline)';

/** File extension the offline encoder emits, used for the fallback filename. */
export const OFFLINE_EXT = 'webp';

/** The two actionable menu items, in the vocabulary the background branches on. */
export type MenuAction = 'optimize' | 'download-offline';

/** Map a clicked menuItemId to its action, or null for the parent/unknown ids. */
export function menuActionFor(menuItemId: string | number): MenuAction | null {
  switch (menuItemId) {
    case MENU_OPTIMIZE_ID:
      return 'optimize';
    case MENU_DOWNLOAD_OFFLINE_ID:
      return 'download-offline';
    default:
      return null;
  }
}

/**
 * Derive a download filename from an image URL, swapping in the encoded
 * extension: `https://x.test/photo.jpg?v=2` -> `photo.webp`. Querystrings,
 * hashes, and percent-encoding are handled; data:/blob: URLs and paths with no
 * usable last segment fall back to `image`.
 */
export function deriveFileName(src: string, ext: string): string {
  return `${baseNameFromSrc(src)}.${ext}`;
}

function baseNameFromSrc(src: string): string {
  let pathname: string;
  try {
    const url = new URL(src);
    // data:/blob: pathnames are the payload/opaque id, not a filename.
    if (url.protocol === 'data:' || url.protocol === 'blob:') return 'image';
    pathname = url.pathname;
  } catch {
    // Relative or malformed input: strip the query/hash by hand.
    pathname = src.split(/[?#]/)[0] ?? src;
  }
  const last = pathname.split('/').filter(Boolean).pop();
  if (!last) return 'image';
  let name: string;
  try {
    name = decodeURIComponent(last);
  } catch {
    name = last;
  }
  // Drop a single trailing extension (photo.jpg -> photo); keep earlier dots.
  name = name.replace(/\.[^.\\/]+$/, '').trim();
  return name || 'image';
}

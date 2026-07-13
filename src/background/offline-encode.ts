// Offline client-side compression for the "Download as WebP (offline)" context
// menu item. Runs in the service worker, the one surface with host_permissions,
// so it fetches the image bytes itself: drawing a cross-origin bitmap fetched by
// URL would taint the OffscreenCanvas and make convertToBlob throw SecurityError.
// Fetch -> Blob -> createImageBitmap keeps the canvas origin-clean.
//
// Codec note: this ships the SW-native WebP path (OffscreenCanvas.convertToBlob).
// The preferred @jsquash/avif wasm path was not verifiable within the task (no
// interactive Chrome to exercise the worker under the MV3 CSP), so per the brief
// we fell back to WebP. To swap in AVIF later, replace encodeOffline's body and
// the OFFLINE_MENU_TITLE/OFFLINE_EXT in shared/context-menu.ts; nothing else
// changes.
import { OFFLINE_EXT } from '../shared/context-menu';

/** The encoded image marshaled to the content script (base64, ArrayBuffers do
 *  not survive sendMessage) plus the type/extension the download needs. */
export interface EncodedImage {
  base64: string;
  contentType: string;
  ext: string;
}

/** WebP quality for the offline encode (0..1), matching the brief. */
const WEBP_QUALITY = 0.8;

/**
 * Fetch an image, decode it, and re-encode it to WebP entirely on-device. Throws
 * on a failed fetch or an undecodable resource (SVG, exotic blobs); callers fail
 * quietly on those.
 */
export async function encodeOffline(srcUrl: string): Promise<EncodedImage> {
  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error(`could not fetch image (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context for offline encode');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
    const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    return { base64, contentType: blob.type || 'image/webp', ext: OFFLINE_EXT };
  } finally {
    bitmap.close();
  }
}

/** Chunked btoa so a large byte array does not overflow the apply() stack. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

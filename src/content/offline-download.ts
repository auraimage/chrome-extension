// Content-script side of the offline compress flow (Task 7). The background
// worker fetches, decodes, and re-encodes the image, then hands the bytes here to
// trigger a blob-URL anchor download (keeping the extension off the `downloads`
// permission) and to surface the gate / failure notice as an in-page toast.
import { ensureOverlayHost } from './overlay';

/** Rebuild the encoded blob from the base64 body marshaled over messaging. */
function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

/** Save the offline-encoded bytes via a transient blob URL and anchor click. */
export function triggerOfflineDownload(base64: string, contentType: string, fileName: string): void {
  const url = URL.createObjectURL(base64ToBlob(base64, contentType));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // Defer the revoke: revoking synchronously can cancel an in-flight download.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const NOTICE_STYLE_ID = 'aura-offline-notice-style';

// Mirrors the optimize panel's mono, hue-260 look; pointer-events auto so the
// CTA is clickable inside the otherwise click-through overlay host.
const NOTICE_STYLE = `
  .aonote {
    --popover: oklch(0.985 0.003 260);
    --fg: oklch(0.12 0.005 260);
    --border: oklch(0.91 0.003 260);
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    max-width: min(420px, calc(100vw - 32px)); padding: 10px 14px;
    color: var(--fg); background: var(--popover); border: 1px solid var(--border);
    border-radius: 8px; pointer-events: auto;
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; font-size: 12px; line-height: 1.5;
  }
  @media (prefers-color-scheme: dark) {
    .aonote {
      --popover: oklch(0.17 0.005 260);
      --fg: oklch(0.95 0.003 260);
      --border: oklch(0.28 0.005 260);
    }
  }
  .aonote a { color: var(--fg); text-decoration: underline; }
`;

/**
 * Show a transient toast in the overlay shadow root. With `ctaHref` it renders a
 * "create a free project" link (the gate); without one it is a plain notice.
 */
export function showOfflineNotice(text: string, ctaHref?: string): void {
  const host = ensureOverlayHost();
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (!shadow.getElementById(NOTICE_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = NOTICE_STYLE_ID;
    style.textContent = NOTICE_STYLE;
    shadow.append(style);
  }

  const note = document.createElement('div');
  note.className = 'aonote';
  note.append(document.createTextNode(text));
  if (ctaHref) {
    const link = document.createElement('a');
    link.href = ctaHref;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'create a free project';
    note.append(document.createTextNode(' '), link);
  }
  shadow.append(note);
  setTimeout(() => note.remove(), 6_000);
}

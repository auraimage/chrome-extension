// AuraImage X-Ray service worker (MV3 ESM module). It is the only surface with
// host_permissions, so it owns every edge fetch: content and popup, which are
// bound by the page's CORS/CSP, message it here and it proxies to api.ts. Bytes
// come back base64-encoded because ArrayBuffers don't survive sendMessage. It
// also owns the image context menu, the offline compress fetch/encode, and the
// Size probe fallback (ADR 0026), for the same host-permission reason.
import { type EncodedImage, encodeOffline } from '@/background/offline-encode';
import { probeSize } from '@/background/probe-size';
import {
  DemoExhausted,
  EdgeUnavailable,
  NotConfigured,
  RateLimited,
  demoAlt,
  demoTransformBytes,
  demoTransformStats
} from '@/shared/api';
import {
  MENU_DOWNLOAD_OFFLINE_ID,
  MENU_OPTIMIZE_ID,
  MENU_PARENT_ID,
  OFFLINE_MENU_TITLE,
  deriveFileName,
  menuActionFor
} from '@/shared/context-menu';
import { GATE_CTA_URL, isExportGated, recordExport } from '@/shared/gate';
import type {
  DemoAltRequest,
  DemoBytesRequest,
  DemoErrorKind,
  DemoResult,
  DemoStatsRequest,
  SizeProbeRequest
} from '@/shared/types';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

/** Fire-and-forget message to a tab; swallow "no receiving end" on restricted
 *  pages (the send rejects when there is no content script to receive). */
function sendToTab(tabId: number, message: unknown): void {
  // Promise form (Firefox's `browser` is promise-based); the .catch swallows the
  // "no receiving end" rejection on restricted pages with no content script.
  void browser.tabs.sendMessage(tabId, message).catch(() => {});
}

/**
 * Offline compress a right-clicked image and hand the bytes to the content
 * script to download. The export passes through the same gate as edge exports,
 * and is only counted once the content script confirms delivery (a restricted
 * page has no receiver, so it must not over-count).
 */
async function handleOfflineDownload(tabId: number, srcUrl: string): Promise<void> {
  if (await isExportGated()) {
    sendToTab(tabId, {
      type: 'aura:offline-notice',
      text: 'free export limit reached.',
      ctaHref: GATE_CTA_URL
    });
    return;
  }

  let encoded: EncodedImage;
  try {
    encoded = await encodeOffline(srcUrl);
  } catch {
    // Undecodable resource (SVG, exotic blob) or a failed fetch: fail quietly
    // with a notice; nothing here is actionable to log.
    sendToTab(tabId, { type: 'aura:offline-notice', text: 'could not compress this image offline.' });
    return;
  }

  const fileName = deriveFileName(srcUrl, encoded.ext);
  // A restricted page has no content script, so the send rejects: count the
  // export against the gate only on delivery, never when nothing was received.
  browser.tabs
    .sendMessage(tabId, {
      type: 'aura:offline-download',
      base64: encoded.base64,
      contentType: encoded.contentType,
      fileName
    })
    .then(
      () => void recordExport(),
      () => {}
    );
}

function isType<T extends { type: string }>(message: unknown, type: T['type']): message is T {
  return typeof message === 'object' && message !== null && (message as { type?: string }).type === type;
}

/** Map a thrown api.ts error to the serializable result the callers branch on. */
function toResult(error: unknown): DemoResult<never> {
  let kind: DemoErrorKind = 'network';
  if (error instanceof DemoExhausted) kind = 'exhausted';
  else if (error instanceof RateLimited) kind = 'rate-limited';
  else if (error instanceof NotConfigured) kind = 'not-configured';
  else if (error instanceof EdgeUnavailable) kind = 'edge-unavailable';
  else if (error instanceof DOMException && error.name === 'TimeoutError') kind = 'timeout';
  const message = error instanceof Error ? error.message : 'demo request failed';
  return { ok: false, error: kind, message };
}

/** Run an edge call and reply once, translating success/failure into a result. */
function reply<T>(work: Promise<T>, sendResponse: (result: DemoResult<T>) => void): void {
  work.then(
    (value) => sendResponse({ ok: true, value }),
    (error) => sendResponse(toResult(error))
  );
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    // Rebuild from scratch so a reinstall/update never hits a duplicate-id error.
    // `removeAll` is awaited (not callback-style): on Firefox the native
    // `browser` is promise-based and would drop the callback, so the menu would
    // never be (re)built and both right-click actions would silently vanish.
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({ id: MENU_PARENT_ID, title: 'AuraImage', contexts: ['image'] });
    browser.contextMenus.create({
      id: MENU_OPTIMIZE_ID,
      parentId: MENU_PARENT_ID,
      title: 'Optimize this image',
      contexts: ['image']
    });
    browser.contextMenus.create({
      id: MENU_DOWNLOAD_OFFLINE_ID,
      parentId: MENU_PARENT_ID,
      title: OFFLINE_MENU_TITLE,
      contexts: ['image']
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const action = menuActionFor(info.menuItemId);
    const tabId = tab?.id;
    if (!action || tabId === undefined || !info.srcUrl) return;
    if (action === 'optimize') {
      sendToTab(tabId, { type: 'aura:open-optimize', src: info.srcUrl });
      return;
    }
    void handleOfflineDownload(tabId, info.srcUrl);
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isType<DemoStatsRequest>(message, 'aura:demo-stats')) {
      reply(demoTransformStats(message.src, message.opts), sendResponse);
      return true; // keep the channel open for the async reply
    }
    if (isType<DemoBytesRequest>(message, 'aura:demo-bytes')) {
      reply(demoTransformBytes(message.src, message.opts), sendResponse);
      return true;
    }
    if (isType<DemoAltRequest>(message, 'aura:demo-alt')) {
      reply(
        demoAlt(message.src).then((alt) => ({ alt })),
        sendResponse
      );
      return true;
    }
    if (isType<SizeProbeRequest>(message, 'aura:probe-size')) {
      reply(probeSize(message.src), sendResponse);
      return true;
    }
    return false;
  });
});

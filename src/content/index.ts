// AuraImage X-Ray content script (classic script, injected on every page).
// Ambient pass: collect image facts from the DOM, analyze them with the Task 4
// lib, and badge the page via the shadow-DOM overlay. Answers the popup's
// aura:get-findings request and the aura:toggle-overlay command. Zero network
// calls to the AuraImage edge.
import { aggregate, analyzeImage } from '../shared/analyze';
import { MUTED_HOSTS_KEY, isHostMuted } from '../shared/mute';
import type {
  FindingsResponse,
  OfflineDownloadMessage,
  OfflineNoticeMessage,
  OpenOptimizeMessage,
  PageFindings
} from '../shared/types';
import { collectFacts, startLcpObserver } from './collect';
import { showOfflineNotice, triggerOfflineDownload } from './offline-download';
import { createOptimizePanel } from './optimize-panel';
import { type AnalyzedImage, createOverlay } from './overlay';

const optimizePanel = createOptimizePanel();
const overlay = createOverlay((src) => optimizePanel.open(src));

let latestFindings: PageFindings = aggregate([]);
let renderedImageCount = 0;

/** Re-read the DOM, re-analyze, and rebuild the overlay + cached findings. */
function recollect(): void {
  const collected = collectFacts();
  const analyzed: AnalyzedImage[] = collected.map((c) => ({ findings: analyzeImage(c.facts), elements: c.elements }));
  latestFindings = aggregate(analyzed.map((a) => a.findings));
  renderedImageCount = collected.reduce((total, c) => total + c.elements.length, 0);
  overlay.render(analyzed);
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

async function applyMuteState(): Promise<void> {
  overlay.setVisible(!(await isHostMuted(location.hostname)));
}

function isGetFindings(message: unknown): boolean {
  return typeof message === 'object' && message !== null && (message as { type?: string }).type === 'aura:get-findings';
}

function isToggleOverlay(message: unknown): boolean {
  return (
    typeof message === 'object' && message !== null && (message as { type?: string }).type === 'aura:toggle-overlay'
  );
}

function messageType(message: unknown): string | undefined {
  return typeof message === 'object' && message !== null ? (message as { type?: string }).type : undefined;
}

// Registered synchronously (not behind an await) so the popup always finds a
// receiver on a normal page; it answers with the latest cached findings.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isGetFindings(message)) {
    const response: FindingsResponse = {
      findings: latestFindings,
      pageUrl: location.href,
      renderedImageCount
    };
    sendResponse(response);
    return false;
  }
  if (isToggleOverlay(message)) {
    overlay.setVisible(!overlay.isVisible());
    return false;
  }
  switch (messageType(message)) {
    case 'aura:open-optimize':
      optimizePanel.open((message as OpenOptimizeMessage).src);
      return false;
    case 'aura:offline-download': {
      const { base64, contentType, fileName } = message as OfflineDownloadMessage;
      triggerOfflineDownload(base64, contentType, fileName);
      // Ack so the background can tell "delivered" from "no receiver" (restricted
      // page) and only count the export against the gate on delivery.
      sendResponse({ ok: true });
      return false;
    }
    case 'aura:offline-notice': {
      const notice = message as OfflineNoticeMessage;
      showOfflineNotice(notice.text, notice.ctaHref);
      return false;
    }
    default:
      return false;
  }
});

async function init(): Promise<void> {
  await applyMuteState();
  recollect();
  startLcpObserver(recollect);

  // Late-arriving resource-timing entries and image loads refine the facts.
  if (document.readyState !== 'complete') {
    window.addEventListener('load', recollect, { once: true });
  }

  // SPA navigations mutate the DOM without a full reload; re-collect, debounced.
  // childList + subtree only (never attributes) to avoid a mutation feedback loop.
  const observer = new MutationObserver(debounce(recollect, 500));
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });

  // Reflect mute/unmute performed from the popup.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[MUTED_HOSTS_KEY]) void applyMuteState();
  });
}

void init();

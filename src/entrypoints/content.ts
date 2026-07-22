// AuraImage X-Ray content script (injected on every page). Ambient pass: collect
// image facts from the DOM, analyze them with the Task 4 lib, and badge the page
// via the shadow-DOM overlay. Answers the popup's aura:get-findings request. Zero
// network calls to the AuraImage edge; the Size probe (ADR 0026) may re-request
// page images from their own hosts.
import { collectFacts, startLcpObserver } from '@/content/collect';
import { showOfflineNotice, triggerOfflineDownload } from '@/content/offline-download';
import { createOptimizePanel } from '@/content/optimize-panel';
import { type AnalyzedImage, createOverlay } from '@/content/overlay';
import { probeOutcome, queueSizeProbes } from '@/content/size-probe';
import { aggregate, analyzeImage } from '@/shared/analyze';
import { BADGES_ENABLED_KEY, getBadgesEnabled, setBadgesEnabled } from '@/shared/badge-switch';
import { MUTED_HOSTS_KEY, isHostMuted } from '@/shared/mute';
import type {
  FindingsResponse,
  OfflineDownloadMessage,
  OfflineNoticeMessage,
  OpenOptimizeMessage,
  PageFindings
} from '@/shared/types';
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function isGetFindings(message: unknown): boolean {
  return typeof message === 'object' && message !== null && (message as { type?: string }).type === 'aura:get-findings';
}

function messageType(message: unknown): string | undefined {
  return typeof message === 'object' && message !== null ? (message as { type?: string }).type : undefined;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    const optimizePanel = createOptimizePanel();
    const overlay = createOverlay(
      (src) => optimizePanel.open(src),
      (next) => void setBadgesEnabled(next)
    );

    let latestFindings: PageFindings = aggregate([]);
    let renderedImageCount = 0;

    /** Re-read the DOM, re-analyze, and rebuild the overlay + cached findings. */
    function recollect(): void {
      const collected = collectFacts();

      // Fill timing-hidden sizes from settled Size probes; queue probes for the
      // rest. Settled probes re-enter here (debounced) to update the badges.
      const unprobed: string[] = [];
      for (const { facts } of collected) {
        if (facts.transferBytes !== null || facts.currentSrc.startsWith('data:')) continue;
        const outcome = probeOutcome(facts.currentSrc);
        if (outcome === undefined) unprobed.push(facts.currentSrc);
        else if (outcome === 'unavailable') facts.sizeUnavailable = true;
        else facts.transferBytes = outcome.bytes;
      }

      const analyzed: AnalyzedImage[] = collected.map((c) => ({
        findings: analyzeImage(c.facts),
        elements: c.elements
      }));
      latestFindings = aggregate(analyzed.map((a) => a.findings));
      renderedImageCount = collected.reduce((total, c) => total + c.elements.length, 0);
      overlay.render(analyzed);

      queueSizeProbes(unprobed, debouncedProbeRecollect);
    }

    const debouncedProbeRecollect = debounce(recollect, 250);

    /** Site mute hides everything; the Badge switch hides badges but not the switcher. */
    async function applyVisibilityState(): Promise<void> {
      const [muted, enabled] = await Promise.all([isHostMuted(location.hostname), getBadgesEnabled()]);
      overlay.setMuted(muted);
      overlay.setBadgesEnabled(enabled);
    }

    // Registered synchronously (not behind an await) so the popup always finds a
    // receiver on a normal page; it answers with the latest cached findings.
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (isGetFindings(message)) {
        const response: FindingsResponse = {
          findings: latestFindings,
          pageUrl: location.href,
          renderedImageCount
        };
        sendResponse(response);
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

    void (async () => {
      await applyVisibilityState();
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

      // Reflect mute/unmute and Badge switch flips from the popup or other tabs.
      browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && (changes[MUTED_HOSTS_KEY] || changes[BADGES_ENABLED_KEY])) void applyVisibilityState();
      });
    })();
  }
});

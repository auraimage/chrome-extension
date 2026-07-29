// Popup entry point. Asks the active tab for its ambient findings, renders the
// Findings card, and wires the copy-markdown / download-png / mute / badge
// switch actions. Restricted pages (chrome://, the Web Store) where the content
// script cannot run degrade to a "can't read this page" message.
import { CARD_CANVAS, colorFor, fontFor, layoutCard } from '@/popup/card-layout';
import { buildFindingsMarkdown } from '@/popup/findings-markdown';
import { type FindingsCardModel, buildFindingsCardModel } from '@/popup/findings-model';
import { type AuraImageRef, parseAuraImageUrl } from '@/shared/aura-url';
import { getBadgesEnabled, setBadgesEnabled } from '@/shared/badge-switch';
import { GATE_CTA_URL, isExportGated, recordExport } from '@/shared/gate';
import { isHostMuted, setHostMuted } from '@/shared/mute';
import { buildAgentPrompt, buildPictureSnippet } from '@/shared/snippet';
import type { FindingsResponse, PageFindings } from '@/shared/types';
import { browser } from 'wxt/browser';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

function isRestrictedUrl(url?: string): boolean {
  if (!url) return true;
  if (/^(chrome|edge|brave|about|chrome-extension|moz-extension|view-source|devtools):/i.test(url)) return true;
  return url.startsWith('https://chromewebstore.google.com') || url.startsWith('https://chrome.google.com/webstore');
}

function hostnameOf(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** tabs.sendMessage in promise form; rejects on a missing receiver (Firefox's
 *  native `browser` is promise-based and would drop a trailing callback). */
async function requestFindings(tabId: number): Promise<FindingsResponse> {
  const response = (await browser.tabs.sendMessage(tabId, { type: 'aura:get-findings' })) as
    FindingsResponse | undefined;
  if (!response) throw new Error('no findings');
  return response;
}

function renderRestricted(app: HTMLElement): void {
  app.replaceChildren(
    el('div', { className: 'card' }, [
      el('p', { className: 'eyebrow', textContent: 'aura x-ray' }),
      el('p', {
        className: 'hint',
        textContent: "Can't read this page. Open a normal website to x-ray its images."
      })
    ])
  );
}

function statBlock(label: string, value: string): HTMLElement {
  return el('div', { className: 'stat' }, [el('dt', { textContent: label }), el('dd', { textContent: value })]);
}

/** Briefly swap a button's label to confirm an action ran. */
function flash(button: HTMLButtonElement, message: string): void {
  const original = button.textContent ?? '';
  button.textContent = message;
  setTimeout(() => {
    button.textContent = original;
  }, 1500);
}

/** Draw the share card to a 1200x630 canvas from the tested layout rows. */
function drawCard(model: FindingsCardModel): HTMLCanvasElement {
  const canvas = el('canvas', { width: CARD_CANVAS.width, height: CARD_CANVAS.height });
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = CARD_CANVAS.color.bg;
  ctx.fillRect(0, 0, CARD_CANVAS.width, CARD_CANVAS.height);

  const inset = 32;
  ctx.beginPath();
  ctx.roundRect(inset, inset, CARD_CANVAS.width - inset * 2, CARD_CANVAS.height - inset * 2, CARD_CANVAS.radius);
  ctx.fillStyle = CARD_CANVAS.color.card;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = CARD_CANVAS.color.border;
  ctx.stroke();

  for (const row of layoutCard(model)) {
    ctx.font = fontFor(row.role);
    ctx.fillStyle = colorFor(row.role);
    ctx.textAlign = row.align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(row.text, row.x, row.y);
  }
  return canvas;
}

function downloadPng(model: FindingsCardModel, button: HTMLButtonElement): void {
  drawCard(model).toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = el('a', { href: url, download: `aura-findings-${model.hostname}.png` });
    anchor.click();
    // Defer the revoke: revoking synchronously can cancel an in-flight download.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    flash(button, 'saved');
  }, 'image/png');
}

async function copyMarkdown(model: FindingsCardModel, button: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(buildFindingsMarkdown(model));
    flash(button, 'copied');
  } catch {
    flash(button, 'copy failed');
  }
}

/** Public (http/https) image URLs on the page, for the agent migration prompt. */
function pageImageUrls(findings: PageFindings): string[] {
  return findings.images.map((img) => img.facts.currentSrc).filter((src) => /^https?:/i.test(src));
}

/** First image already on our edge, parsed to {project, name}, or null. */
function firstAuraImageRef(findings: PageFindings): AuraImageRef | null {
  for (const img of findings.images) {
    const ref = parseAuraImageUrl(img.facts.currentSrc);
    if (ref) return ref;
  }
  return null;
}

/** The "create a free project" CTA that replaces a gated export control. */
function gateLink(): HTMLAnchorElement {
  return el('a', {
    className: 'gate wide',
    href: GATE_CTA_URL,
    target: '_blank',
    rel: 'noreferrer',
    textContent: 'create a free project to keep shipping these'
  });
}

/**
 * The gated "copy <picture> snippet" control. Copying a snippet is an export, so
 * it passes through the same gate as the panel: free until the allowance is spent,
 * then replaced by the CTA link.
 */
async function snippetControl(ref: AuraImageRef): Promise<HTMLElement> {
  if (await isExportGated()) return gateLink();
  const button = el('button', { type: 'button', className: 'wide', textContent: 'copy <picture> snippet' });
  button.addEventListener('click', () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(buildPictureSnippet({ name: ref.name, project: ref.project }));
        await recordExport();
        flash(button, 'copied');
        if (await isExportGated()) button.replaceWith(gateLink());
      } catch {
        flash(button, 'copy failed');
      }
    })();
  });
  return button;
}

function renderCard(
  app: HTMLElement,
  model: FindingsCardModel,
  hostname: string,
  findings: PageFindings,
  pageUrl: string
): void {
  const stats = el('dl', { className: 'stats' }, [
    statBlock('images', String(model.imageCount)),
    statBlock('total', model.totalBytesText),
    statBlock('wasteful (est)', model.wastefulBytesText)
  ]);
  if (model.estLcpSavingText) stats.append(statBlock('est. LCP saving', model.estLcpSavingText));

  const card = el('div', { className: 'card' }, [
    el('p', { className: 'eyebrow', textContent: 'aura x-ray' }),
    el('h1', { className: 'name', textContent: model.hostname }),
    stats
  ]);

  if (model.lcpImageName) {
    card.append(el('p', { className: 'lcp', textContent: `LCP image: ${model.lcpImageName}` }));
  }

  const flags = el('ul', { className: 'flags' });
  for (const flag of model.flags) {
    flags.append(
      el('li', {}, [el('span', { textContent: flag.label }), el('span', { textContent: String(flag.count) })])
    );
  }
  card.append(flags);

  if (model.cdnName) {
    card.append(
      el('p', {
        className: 'cdn',
        textContent: `served via ${model.cdnName}. AuraImage would ship it smaller, try it below.`
      })
    );
  }

  const copyButton = el('button', { type: 'button', textContent: 'copy markdown' });
  copyButton.addEventListener('click', () => void copyMarkdown(model, copyButton));

  const pngButton = el('button', { type: 'button', textContent: 'download png' });
  pngButton.addEventListener('click', () => downloadPng(model, pngButton));

  // Same wording as the on-page switcher menu: "mute" stays the domain term,
  // "hide" is the UI verb everywhere a user reads it (CONTEXT.md "Site mute").
  const muteLabel = (muted: boolean): string => (muted ? `show on ${hostname}` : `hide on ${hostname}`);
  const muteButton = el('button', { type: 'button', textContent: muteLabel(false) });
  void isHostMuted(hostname).then((muted) => {
    muteButton.textContent = muteLabel(muted);
  });
  muteButton.addEventListener('click', () => {
    void (async () => {
      const nextMuted = !(await isHostMuted(hostname));
      await setHostMuted(hostname, nextMuted);
      muteButton.textContent = muteLabel(nextMuted);
    })();
  });

  // The Badge switch: same persisted state as the on-page switcher, all sites.
  const badgesLabel = (enabled: boolean): string => (enabled ? 'hide on every site' : 'show on every site');
  const badgesButton = el('button', { type: 'button', textContent: badgesLabel(true) });
  void getBadgesEnabled().then((enabled) => {
    badgesButton.textContent = badgesLabel(enabled);
  });
  badgesButton.addEventListener('click', () => {
    void (async () => {
      const next = !(await getBadgesEnabled());
      await setBadgesEnabled(next);
      badgesButton.textContent = badgesLabel(next);
    })();
  });

  const promptButton = el('button', { type: 'button', className: 'wide', textContent: 'copy agent prompt' });
  promptButton.addEventListener('click', () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(buildAgentPrompt(pageUrl, pageImageUrls(findings)));
        flash(promptButton, 'copied');
      } catch {
        flash(promptButton, 'copy failed');
      }
    })();
  });

  const actions = el('div', { className: 'actions' }, [copyButton, pngButton, muteButton, badgesButton, promptButton]);
  app.replaceChildren(card, actions);

  // Offer a real <picture> snippet only when an image is already on our edge.
  const auraRef = firstAuraImageRef(findings);
  if (auraRef) void snippetControl(auraRef).then((control) => actions.append(control));
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    renderRestricted(app);
    return;
  }

  let response: FindingsResponse;
  try {
    response = await requestFindings(tab.id);
  } catch {
    renderRestricted(app);
    return;
  }

  const hostname = hostnameOf(tab.url) ?? hostnameOf(response.pageUrl) ?? 'this page';
  const model = buildFindingsCardModel({
    hostname,
    findings: response.findings,
    imageCount: response.renderedImageCount
  });
  renderCard(app, model, hostname, response.findings, response.pageUrl);
}

void main();

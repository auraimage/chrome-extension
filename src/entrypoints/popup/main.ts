// Popup entry point. Asks the active tab for its ambient findings, renders the
// Findings card (headline wasteful estimate, flag counts, the `fix first` list),
// and wires the copy-markdown / download-png / agent-prompt actions plus the two
// badge switches. Restricted pages (chrome://, the Web Store) where the content
// script cannot run degrade to a "can't read this page" message.
import { CARD_CANVAS, colorFor, fontFor, layoutCard } from '@/popup/card-layout';
import { buildFindingsMarkdown } from '@/popup/findings-markdown';
import { type FindingsCardModel, buildFindingsCardModel } from '@/popup/findings-model';
import { type AuraImageRef, parseAuraImageUrl } from '@/shared/aura-url';
import { getBadgesEnabled, setBadgesEnabled } from '@/shared/badge-switch';
import { FREE_EXPORT_ALLOWANCE, GATE_CTA_URL, isExportGated, recordExport } from '@/shared/gate';
import { isHostMuted, setHostMuted } from '@/shared/mute';
import { buildAgentPrompt, buildPictureSnippet } from '@/shared/snippet';
import type {
  FindingsResponse,
  HighlightKey,
  HighlightResponse,
  OpenOptimizeMessage,
  PageFindings,
  SetHighlightMessage
} from '@/shared/types';
import { browser } from 'wxt/browser';

/** How long a button wears its copied/saved/failed label before reverting. */
const FLASH_MS = 1500;

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

/** The eyebrow + hostname block every popup state opens with. */
function header(title: string, meta?: string): HTMLElement {
  const head = el('header', { className: 'head' }, [
    el('p', { className: 'eyebrow', textContent: 'aura x-ray' }),
    el('h1', { className: 'name', textContent: title })
  ]);
  if (meta) head.append(el('p', { className: 'meta', textContent: meta }));
  return head;
}

function renderRestricted(app: HTMLElement): void {
  app.replaceChildren(
    header("Can't read this page"),
    el('p', { className: 'hint', textContent: 'Open a normal website to x-ray its images.' })
  );
}

/** One label/value stat; `tone` is `loss` (bytes paid) or `win` (a saving). */
function statBlock(label: string, value: string, tone: 'loss' | 'win', headline = false): HTMLElement {
  const classes = ['stat', tone];
  if (headline) classes.push('headline');
  return el('div', { className: classes.join(' ') }, [
    el('dt', { textContent: label }),
    el('dd', { textContent: value })
  ]);
}

/**
 * Briefly swap a button's label to confirm an action ran, tinting it in the win
 * tone (copied, saved) or the loss tone (failed). Re-entrant: a second flash
 * during the first keeps the original label and restarts the timer.
 */
function flash(button: HTMLButtonElement, message: string, tone: 'win' | 'loss'): void {
  if (button.dataset.label === undefined) button.dataset.label = button.textContent ?? '';
  button.textContent = message;
  button.classList.remove('is-win', 'is-loss');
  button.classList.add(`is-${tone}`);
  clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(
    setTimeout(() => {
      button.textContent = button.dataset.label ?? '';
      delete button.dataset.label;
      button.classList.remove('is-win', 'is-loss');
    }, FLASH_MS)
  );
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
    if (!blob) {
      flash(button, 'failed', 'loss');
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = el('a', { href: url, download: `aura-findings-${model.hostname}.png` });
    anchor.click();
    // Defer the revoke: revoking synchronously can cancel an in-flight download.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    flash(button, 'saved', 'win');
  }, 'image/png');
}

async function copyText(text: string, button: HTMLButtonElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    flash(button, 'copied', 'win');
    return true;
  } catch {
    flash(button, 'copy failed', 'loss');
    return false;
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

/** The note that replaces a gated export control: the allowance is spent. */
function gateNote(): HTMLElement {
  return el('p', { className: 'gate-note' }, [
    `${FREE_EXPORT_ALLOWANCE} of ${FREE_EXPORT_ALLOWANCE} free exports used. `,
    el('a', { href: GATE_CTA_URL, target: '_blank', rel: 'noreferrer', textContent: 'create a free project' })
  ]);
}

/**
 * The gated "copy <picture> snippet" control. Copying a snippet is an export, so
 * it passes through the same gate as the panel: free until the allowance is spent,
 * then replaced by the gate note.
 */
async function snippetControl(ref: AuraImageRef): Promise<HTMLElement> {
  if (await isExportGated()) return gateNote();
  const button = el('button', { type: 'button', className: 'wide', textContent: 'copy <picture> snippet' });
  button.addEventListener('click', () => {
    void (async () => {
      const copied = await copyText(buildPictureSnippet({ name: ref.name, project: ref.project }), button);
      if (!copied) return;
      await recordExport();
      if (await isExportGated()) setTimeout(() => button.replaceWith(gateNote()), FLASH_MS);
    })();
  });
  return button;
}

/** Ask the tab to open its optimize panel on one image, then get out of the way. */
function openOptimize(tabId: number, src: string): void {
  const message: OpenOptimizeMessage = { type: 'aura:open-optimize', src };
  void browser.tabs.sendMessage(tabId, message).catch(() => {});
  window.close();
}

/**
 * Ask the tab to frame every image matching `key` (null clears). Resolves to
 * the key the page actually applied, so the popup's pressed state mirrors the
 * page rather than assuming. A missing receiver reads as "nothing highlighted".
 */
async function requestHighlight(tabId: number, key: HighlightKey | null): Promise<HighlightKey | null> {
  const message: SetHighlightMessage = { type: 'aura:set-highlight', key };
  try {
    const response = (await browser.tabs.sendMessage(tabId, message)) as HighlightResponse | undefined;
    return response?.key ?? null;
  } catch {
    return null;
  }
}

/**
 * The popup's highlight toggles: the fired flag rows and the LCP row. One
 * key is pressed at a time; pressing it again clears the page. The popup
 * stays open so a second flag is one click away and the page is visible
 * behind it as the frames land.
 */
interface HighlightToggles {
  /** Register a toggle; its pressed state follows `active`. */
  add(key: HighlightKey, button: HTMLButtonElement): void;
}

function highlightToggles(tabId: number, initial: HighlightKey | null): HighlightToggles {
  const buttons = new Map<HighlightKey, HTMLButtonElement>();
  let active = initial;
  function sync(): void {
    for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === active));
  }
  return {
    add(key, button) {
      buttons.set(key, button);
      button.setAttribute('aria-pressed', String(key === active));
      button.addEventListener('click', () => {
        void requestHighlight(tabId, active === key ? null : key).then((applied) => {
          active = applied;
          sync();
        });
      });
    }
  };
}

interface SwitchRow {
  row: HTMLElement;
  button: HTMLButtonElement;
  setChecked(checked: boolean): void;
}

/**
 * A labeled `role="switch"` row. The scope (a hostname, "every site") is the
 * part that can truncate, so it lives in its own span with the full phrase in
 * `title`; the accessible name comes from the visible label (WCAG 2.5.3).
 */
function switchRow(id: string, scope: string, checked: boolean): SwitchRow {
  const scopeEl = el('b', { textContent: scope });
  const text = el('span', { className: 'switch-text', id: `${id}-label`, title: `badges on ${scope}` }, [
    'badges on ',
    scopeEl
  ]);
  const button = el('button', { type: 'button', className: 'switch', id }, [el('span', { className: 'knob' })]);
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-labelledby', `${id}-label`);
  const row = el('div', { className: 'switch-row' }, [text, button]);
  const setChecked = (next: boolean): void => {
    button.setAttribute('aria-checked', String(next));
    row.classList.toggle('is-off', !next);
  };
  setChecked(checked);
  return { row, button, setChecked };
}

/** The two badge switches: this host (Site mute) and every site (the Badge switch). */
function switches(hostname: string, muted: boolean, badgesOn: boolean): HTMLElement {
  const host = switchRow('badges-host', hostname, !muted);
  const all = switchRow('badges-all', 'every site', badgesOn);
  // Muting is meaningless while badges are off everywhere, so the host switch
  // waits for the global one.
  host.button.disabled = !badgesOn;

  host.button.addEventListener('click', () => {
    void (async () => {
      const nextMuted = !(await isHostMuted(hostname));
      await setHostMuted(hostname, nextMuted);
      host.setChecked(!nextMuted);
    })();
  });
  all.button.addEventListener('click', () => {
    void (async () => {
      const next = !(await getBadgesEnabled());
      await setBadgesEnabled(next);
      all.setChecked(next);
      host.button.disabled = !next;
    })();
  });

  return el('section', { className: 'switches' }, [host.row, all.row]);
}

interface CardContext {
  tabId: number;
  hostname: string;
  findings: PageFindings;
  pageUrl: string;
  muted: boolean;
  badgesOn: boolean;
  /** What the page is framing right now, so the matching row opens pressed. */
  highlight: HighlightKey | null;
}

/** A page with no rendered images: the header, the empty note, and the switches. */
function renderEmpty(app: HTMLElement, model: FindingsCardModel, ctx: CardContext): void {
  app.replaceChildren(header(model.hostname, 'no images rendered'), switches(ctx.hostname, ctx.muted, ctx.badgesOn));
}

function renderCard(app: HTMLElement, model: FindingsCardModel, ctx: CardContext): void {
  const noun = model.imageCount === 1 ? 'image' : 'images';
  const parts: HTMLElement[] = [header(model.hostname, `${model.imageCount} ${noun} · ${model.totalBytesText}`)];

  // The wasteful estimate is the headline: loss-toned while there are bytes to
  // win back, win-toned on a clean page. A saving is always a win.
  const stats = el('dl', { className: 'stats' }, [
    statBlock('wasteful (est)', model.wastefulBytesText, model.wastefulBytes > 0 ? 'loss' : 'win', true)
  ]);
  if (model.estLcpSavingText) stats.append(statBlock('est. LCP saving', model.estLcpSavingText, 'win'));
  parts.push(stats);

  const toggles = highlightToggles(ctx.tabId, ctx.highlight);
  // The `on page` tag is the pressed state's words; the wash is its color.
  const onPage = (): HTMLElement => el('span', { className: 'tag', textContent: 'on page' });

  if (model.lcpImageName) {
    const lcp = el('button', { type: 'button', className: 'lcp', title: 'show the LCP image on the page' }, [
      el('span', { className: 'lcp-text' }, ['LCP image: ', el('b', { textContent: model.lcpImageName })]),
      onPage()
    ]);
    toggles.add('lcp', lcp);
    parts.push(lcp);
  }

  // Flags: a fired flag is a toggle that frames its images on the page; a
  // zero stays a quiet, static row. The count is the signal, the dot echoes it.
  const flagList = el('ul');
  for (const flag of model.flags) {
    const fired = flag.count > 0;
    const children = [
      el('span', { className: 'mark' }),
      el('span', { className: 'label' }, [flag.label, onPage()]),
      el('span', { className: 'count', textContent: String(flag.count) })
    ];
    if (fired) {
      const noun = flag.count === 1 ? 'image' : 'images';
      const row = el(
        'button',
        { type: 'button', className: 'flag-row fired', title: `show ${flag.count} ${flag.label} ${noun} on the page` },
        children
      );
      toggles.add(flag.key, row);
      flagList.append(el('li', {}, [row]));
    } else {
      flagList.append(el('li', {}, [el('div', { className: 'flag-row' }, children)]));
    }
  }
  parts.push(
    el('section', { className: 'flags' }, [
      el('h2', {}, [el('span', { textContent: 'flags' }), el('span', { textContent: 'show on page' })]),
      flagList
    ])
  );

  if (model.fixFirst.length > 0) {
    const fix = el('section', { className: 'fix' }, [
      el('h2', {}, [el('span', { textContent: 'fix first' }), el('span', { textContent: 'est. saving' })])
    ]);
    for (const item of model.fixFirst) {
      const row = el('button', { type: 'button', className: 'fix-row', title: `optimize ${item.name}` }, [
        el('span', { className: 'fix-name', textContent: item.name }),
        el('span', { className: 'fix-save', textContent: item.savingText }),
        el('span', { className: 'fix-go', textContent: '›' })
      ]);
      row.addEventListener('click', () => openOptimize(ctx.tabId, item.src));
      fix.append(row);
    }
    parts.push(fix);
  }

  if (model.cdnName) {
    parts.push(
      el('p', { className: 'cdn' }, [
        'served via ',
        el('b', { textContent: model.cdnName }),
        '. AuraImage would ship it smaller, try it below.'
      ])
    );
  }

  const promptButton = el('button', { type: 'button', className: 'primary wide', textContent: 'copy agent prompt' });
  promptButton.addEventListener('click', () => {
    void copyText(buildAgentPrompt(ctx.pageUrl, pageImageUrls(ctx.findings)), promptButton);
  });

  const copyButton = el('button', { type: 'button', textContent: 'copy markdown' });
  copyButton.addEventListener('click', () => void copyText(buildFindingsMarkdown(model), copyButton));

  const pngButton = el('button', { type: 'button', textContent: 'download png' });
  pngButton.addEventListener('click', () => downloadPng(model, pngButton));

  const actions = el('div', { className: 'actions' }, [promptButton, copyButton, pngButton]);
  parts.push(actions, switches(ctx.hostname, ctx.muted, ctx.badgesOn));
  app.replaceChildren(...parts);

  // Offer a real <picture> snippet only when an image is already on our edge.
  const auraRef = firstAuraImageRef(ctx.findings);
  if (auraRef) void snippetControl(auraRef).then((control) => promptButton.after(control));
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  document.getElementById('options')?.addEventListener('click', (event) => {
    event.preventDefault();
    void browser.runtime.openOptionsPage();
  });

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
  // Read both switch states before the first paint so neither flips on load.
  const [muted, badgesOn] = await Promise.all([isHostMuted(hostname), getBadgesEnabled()]);
  const model = buildFindingsCardModel({
    hostname,
    findings: response.findings,
    imageCount: response.renderedImageCount
  });
  const ctx: CardContext = {
    tabId: tab.id,
    hostname,
    findings: response.findings,
    pageUrl: response.pageUrl,
    muted,
    badgesOn,
    highlight: response.highlight ?? null
  };
  if (model.imageCount === 0) renderEmpty(app, model, ctx);
  else renderCard(app, model, ctx);
}

void main();

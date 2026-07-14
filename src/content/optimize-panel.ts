// The optimize panel: a modal card, rendered into the overlay's shadow root, that
// turns a badge's "optimize" click into real edge proof. It calls the Demo edge
// (through the background proxy) for before/after stats, a blurhash preview, three
// smart-crop thumbnails, downloadable avif/webp, a copy-ready <picture> snippet,
// and AI alt text. Seeing is free; the three export controls pass through the
// gate. Every call has its own loading and error state, and 429/exhausted shows an
// inline wall. Styling mirrors overlay.ts: hue-260 mono, no shadows at rest.
import { formatBytes } from '../shared/format';
import { GATE_CTA_URL, WALL_CTA_URL, isExportGated, recordExport } from '../shared/gate';
import { buildPictureSnippet } from '../shared/snippet';
import type { DemoResult, DemoStats, DemoTransformOpts } from '../shared/types';
import { payloadToBlob, requestAlt, requestBytes, requestStats } from './demo-bridge';
import { buildComparison } from './optimize-model';
import { ensureOverlayHost } from './overlay';
import { decode } from 'blurhash';

export interface OptimizePanel {
  open(src: string): void;
}

const STYLE_ID = 'aura-optimize-style';

const STYLE = `
  .obk {
    --popover: oklch(0.985 0.003 260);
    --fg: oklch(0.12 0.005 260);
    --muted: oklch(0.45 0.005 260);
    --border: oklch(0.91 0.003 260);
    --hover: oklch(0.97 0.003 260);
    --track: oklch(0.94 0.004 260);
    --bar-neutral: oklch(0.78 0.005 260);
    --win: oklch(0.5 0.14 152);
    --loss: oklch(0.5 0.19 27);
    --ring: oklch(0.55 0.18 255);
    position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    padding: 24px; background: oklch(0 0 0 / 0.45); pointer-events: auto;
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    .obk {
      --popover: oklch(0.17 0.005 260);
      --fg: oklch(0.95 0.003 260);
      --muted: oklch(0.65 0.005 260);
      --border: oklch(0.28 0.005 260);
      --hover: oklch(0.22 0.005 260);
      --track: oklch(0.25 0.005 260);
      --bar-neutral: oklch(0.42 0.005 260);
      --win: oklch(0.74 0.13 152);
      --loss: oklch(0.72 0.16 27);
      --ring: oklch(0.65 0.15 255);
    }
  }
  .ocard {
    width: min(380px, 100%); max-height: 88vh; overflow: auto;
    padding: 16px; color: var(--fg); background: var(--popover);
    border: 1px solid var(--border); border-radius: 0.75rem;
    font-size: 12px; line-height: 1.5;
    /* Focused on open only as a keyboard entry point; the visible rings belong
       to the real controls inside. */
    outline: none;
  }
  .ohead { display: flex; align-items: flex-start; gap: 10px; }
  .othumb {
    width: 32px; height: 32px; object-fit: cover; flex: 0 0 auto;
    border: 1px solid var(--border); border-radius: 6px; background: var(--hover);
  }
  .oheadtext { flex: 1; min-width: 0; }
  .oeyebrow { font-size: 11px; letter-spacing: 0.04em; color: var(--muted); }
  .osrc { margin-top: 2px; color: var(--muted); font-size: 11px; word-break: break-all; }
  .obtn {
    padding: 4px 12px; font: inherit; font-size: 11px; color: var(--fg);
    background: transparent; border: 1px solid var(--border); border-radius: 9999px; cursor: pointer;
  }
  .obtn:disabled { opacity: 0.5; cursor: default; }
  .obtn:hover:not(:disabled) { background: var(--hover); }
  .obtn:focus-visible, .ogate:focus-visible, .owall a:focus-visible, .oalt textarea:focus-visible {
    outline: 2px solid var(--ring); outline-offset: 2px;
  }
  .oclose { padding: 2px 8px; }
  .osection { margin-top: 12px; }
  /* The proof block: headline saving, then one measured bar per encoding.
     Tones are semantic only — loss is bytes paid today, win is a real saving,
     neutral means the re-encode does not help. */
  .oheadline { margin-top: 14px; font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
  .oheadline.win { color: var(--win); }
  .obars {
    display: grid; grid-template-columns: max-content 1fr max-content max-content;
    gap: 7px 10px; align-items: center; margin-top: 10px;
  }
  .obar-label { font-size: 11px; color: var(--muted); }
  .obar-track { height: 6px; border-radius: 3px; background: var(--track); overflow: hidden; }
  .obar-fill { height: 100%; border-radius: inherit; transform-origin: left center; background: var(--bar-neutral); }
  .obar-fill.loss { background: var(--loss); }
  .obar-fill.win { background: var(--win); }
  .obar-size { font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; }
  .obar-size.loss { color: var(--loss); }
  .obar-size.win { color: var(--win); }
  .obar-note { font-size: 11px; color: var(--muted); text-align: right; min-width: 4ch; font-variant-numeric: tabular-nums; }
  .obar-note.win { color: var(--win); }
  .ohashrow { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
  .ohash { display: block; flex: 0 0 auto; border: 1px solid var(--border); border-radius: 4px; image-rendering: auto; }
  .orow { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .ocrops { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
  .ocrop { text-align: center; }
  .ocrop canvas { width: 100%; height: 96px; object-fit: cover; border: 1px solid var(--border); border-radius: 4px; background: var(--hover); }
  .ocroplabel { margin-top: 4px; font-size: 10px; color: var(--muted); }
  .ostate { min-height: 96px; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 11px; }
  .omuted { color: var(--muted); font-size: 11px; }
  /* Loading skeleton: same grid as the proof block so the card doesn't jump. */
  .oskel { display: grid; grid-template-columns: max-content 1fr max-content; gap: 12px 10px; align-items: center; margin-top: 18px; min-height: 78px; align-content: start; }
  .oskel-line { height: 8px; border-radius: 3px; background: var(--track); }
  .oskel-label { width: 52px; }
  .oskel-size { width: 40px; }
  .oskel-crop { height: 96px; border-radius: 4px; background: var(--track); }
  .oalt { margin-top: 8px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; }
  .oalt textarea { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 6px; font: inherit; font-size: 11px; color: var(--fg); background: transparent; border: 1px solid var(--border); border-radius: 4px; resize: vertical; }
  .owall { margin-top: 10px; padding: 10px; color: var(--fg); border: 1px solid var(--border); border-radius: 6px; font-size: 11px; }
  .owall a, .ogate { color: var(--fg); text-decoration: underline; }
  @media (prefers-reduced-motion: no-preference) {
    .obtn { transition: background 120ms cubic-bezier(0.2, 0.8, 0.2, 1); }
    .obk { animation: obk-in 150ms ease-out; }
    .ocard { animation: ocard-in 200ms cubic-bezier(0.22, 1, 0.36, 1); }
    .obar-fill { animation: obar-grow 480ms cubic-bezier(0.22, 1, 0.36, 1) backwards; }
    .oskel-line, .oskel-crop { animation: opulse 1.1s ease-in-out infinite alternate; }
  }
  @keyframes obk-in { from { background: oklch(0 0 0 / 0); } }
  @keyframes ocard-in { from { opacity: 0; transform: translateY(6px) scale(0.985); } }
  @keyframes obar-grow { from { transform: scaleX(0); } }
  @keyframes opulse { to { opacity: 0.45; } }
`;

type Props = Partial<HTMLElement> & { class?: string; text?: string };

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class' || key === 'text') continue;
    (el as unknown as Record<string, unknown>)[key] = value;
  }
  for (const child of children) el.append(child);
  return el;
}

/** Only public https images are transformable by the edge (it 400s the rest). */
function isPublicHttps(src: string): boolean {
  try {
    return new URL(src).protocol === 'https:';
  } catch {
    return false;
  }
}

function sourceLabel(src: string): string {
  try {
    const url = new URL(src);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return src;
  }
}

function imageBaseName(src: string): string {
  try {
    const last = new URL(src).pathname.split('/').filter(Boolean).pop();
    const name = last ? decodeURIComponent(last) : 'image';
    return name.replace(/\.[A-Za-z0-9]+$/, '') || 'image';
  } catch {
    return 'image';
  }
}

/** Human copy for a failed edge call, plus the wall CTA when the demo is spent. */
function describeError(result: Extract<DemoResult<unknown>, { ok: false }>): { text: string; wall: boolean } {
  switch (result.error) {
    case 'exhausted':
      return { text: 'demo limit reached, create a free project at auraimage.ai', wall: true };
    case 'rate-limited':
      return { text: 'demo rate limit, retry in a minute', wall: false };
    case 'not-configured':
      return { text: 'alt suggestions are not configured on this edge', wall: false };
    case 'edge-unavailable':
      return { text: 'the demo edge is briefly unavailable, try again', wall: false };
    case 'timeout':
      return { text: 'the edge took too long, try again', wall: false };
    default:
      return { text: result.message || 'could not reach the AuraImage edge', wall: false };
  }
}

export function createOptimizePanel(): OptimizePanel {
  const host = ensureOverlayHost();
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (!shadow.getElementById(STYLE_ID)) {
    const style = h('style', { id: STYLE_ID, text: STYLE });
    shadow.append(style);
  }

  const body = h('div');
  const card = h('div', { class: 'ocard', role: 'dialog', ariaModal: 'true', ariaLabel: 'optimize image' } as Props);
  const srcLine = h('div', { class: 'osrc' });
  const closeBtn = h('button', { class: 'obtn oclose', type: 'button', text: 'close' } as Props);
  // The page has this image decoded already, so the thumbnail is a cache read
  // that anchors "which image am I optimizing" without an extra edge call.
  const thumb = h('img', { class: 'othumb', alt: '' } as Props);
  thumb.setAttribute('aria-hidden', 'true');
  thumb.addEventListener('error', () => {
    thumb.style.display = 'none';
  });
  const headText = h('div', { class: 'oheadtext' }, [h('span', { class: 'oeyebrow', text: 'optimize' }), srcLine]);
  const head = h('div', { class: 'ohead' }, [thumb, headText, closeBtn]);
  card.append(head, body);
  const backdrop = h('div', { class: 'obk' }, [card]);
  shadow.append(backdrop);

  // Each open() bumps the generation so a late response from a previous image
  // (or a since-closed panel) can be dropped instead of rendered into this one.
  let generation = 0;

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }

  function close(): void {
    generation++;
    backdrop.style.display = 'none';
    body.replaceChildren();
    document.removeEventListener('keydown', onKeydown, true);
  }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });

  function open(src: string): void {
    const gen = ++generation;
    srcLine.textContent = sourceLabel(src);
    thumb.style.display = '';
    thumb.src = src;
    backdrop.style.display = 'flex';
    document.addEventListener('keydown', onKeydown, true);
    // Focus the card (not the close button) so Escape/Tab work without a loud
    // focus ring appearing on every mouse open.
    card.tabIndex = -1;
    card.focus({ preventScroll: true });

    if (!isPublicHttps(src)) {
      body.replaceChildren(
        h('div', { class: 'osection omuted', text: 'this image needs a public https URL to optimize' })
      );
      return;
    }

    card.setAttribute('aria-busy', 'true');
    body.replaceChildren(measureSkeleton());
    void loadStats(src, gen);
  }

  /** Loading placeholder in the proof block's own grid, so nothing jumps. */
  function measureSkeleton(): HTMLElement {
    const grid = h('div', { class: 'oskel' });
    for (let row = 0; row < 3; row++) {
      grid.append(
        h('div', { class: 'oskel-line oskel-label' }),
        h('div', { class: 'oskel-line' }),
        h('div', { class: 'oskel-line oskel-size' })
      );
    }
    return grid;
  }

  async function loadStats(src: string, gen: number): Promise<void> {
    const result = await requestStats(src);
    if (gen !== generation) return;
    card.setAttribute('aria-busy', 'false');
    if (!result.ok) {
      const { text, wall } = describeError(result);
      body.replaceChildren(wall ? wallBox(text) : h('div', { class: 'osection ostate', text }));
      return;
    }
    renderStats(src, result.value, gen);
  }

  function renderStats(src: string, stats: DemoStats, gen: number): void {
    const baseName = imageBaseName(src);
    const model = buildComparison(stats);

    const bars = h('div', { class: 'obars' });
    model.rows.forEach((row, index) => {
      const fill = h('div', { class: `obar-fill ${row.tone}` });
      // The keyframe grows from scaleX(0) to this inline resting transform.
      fill.style.transform = `scaleX(${row.widthPct / 100})`;
      fill.style.animationDelay = `${index * 70}ms`;
      bars.append(
        h('div', { class: 'obar-label', text: row.label }),
        h('div', { class: 'obar-track' }, [fill]),
        h('div', { class: `obar-size ${row.tone}`, text: formatBytes(row.bytes) }),
        h('div', { class: row.tone === 'win' ? 'obar-note win' : 'obar-note', text: row.note })
      );
    });

    const summary = h('div', { class: 'osection' }, [
      h('div', { class: `oheadline ${model.headlineTone}`, text: model.headline }),
      bars
    ]);

    const hashCanvas = renderBlurhash(stats);
    if (hashCanvas) {
      summary.append(
        h('div', { class: 'ohashrow' }, [
          hashCanvas,
          h('span', { class: 'omuted', text: 'blurhash preview (loads instantly)' })
        ])
      );
    }

    const exports = h('div', { class: 'orow' });
    const altBox = h('div');

    body.replaceChildren(summary, exports, altBox, cropsSection(src, gen));
    void renderExportControls(exports, src, baseName, altBox, gen);
  }

  function renderBlurhash(stats: DemoStats): HTMLCanvasElement | null {
    if (!stats.blurhash) return null;
    const ratio = stats.height > 0 ? stats.width / stats.height : 1;
    const long = 40;
    const w = ratio >= 1 ? long : Math.max(1, Math.round(long * ratio));
    const hgt = ratio >= 1 ? Math.max(1, Math.round(long / ratio)) : long;
    try {
      const pixels = decode(stats.blurhash, w, hgt);
      const canvas = h('canvas', { class: 'ohash', width: w, height: hgt } as Props);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const imageData = ctx.createImageData(w, hgt);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
      const displayLong = 96;
      canvas.style.width = `${ratio >= 1 ? displayLong : Math.round(displayLong * ratio)}px`;
      canvas.style.height = `${ratio >= 1 ? Math.round(displayLong / ratio) : displayLong}px`;
      return canvas;
    } catch {
      return null;
    }
  }

  async function renderExportControls(
    container: HTMLElement,
    src: string,
    baseName: string,
    altBox: HTMLElement,
    gen: number
  ): Promise<void> {
    const gated = await isExportGated();
    if (gen !== generation) return;
    container.replaceChildren();

    const rerender = () => void renderExportControls(container, src, baseName, altBox, gen);

    const exportControl = (label: string, run: (button: HTMLButtonElement) => Promise<void>): HTMLElement => {
      if (gated) return gateLink();
      const button = h('button', { class: 'obtn', type: 'button', text: label } as Props);
      button.addEventListener('click', () => {
        void (async () => {
          button.disabled = true;
          await run(button);
          button.disabled = false;
        })();
      });
      return button;
    };

    container.append(
      exportControl('download avif', (button) => downloadImage(src, baseName, 'avif', gen, rerender, button)),
      exportControl('download webp', (button) => downloadImage(src, baseName, 'webp', gen, rerender, button)),
      exportControl('copy <picture> snippet', (button) => copySnippet(baseName, rerender, button))
    );

    const altButton = h('button', { class: 'obtn', type: 'button', text: 'suggest alt' } as Props);
    altButton.addEventListener('click', () => {
      altButton.disabled = true;
      void suggestAlt(src, altBox, gen).finally(() => {
        altButton.disabled = false;
      });
    });
    container.append(altButton);
  }

  async function downloadImage(
    src: string,
    baseName: string,
    fmt: 'avif' | 'webp',
    gen: number,
    rerender: () => void,
    button: HTMLButtonElement
  ): Promise<void> {
    const label = button.textContent ?? `download ${fmt}`;
    button.textContent = 'downloading...';
    const result = await requestBytes(src, { fmt });
    if (gen !== generation) return;
    button.textContent = label; // restore before a wall/failed flash or a rerender
    if (!result.ok) {
      handleExportError(result, gen, button);
      return;
    }
    const url = URL.createObjectURL(payloadToBlob(result.value));
    const anchor = h('a', { href: url, download: `${baseName}.${fmt}` } as Props);
    anchor.click();
    // Defer the revoke: revoking synchronously can cancel an in-flight download.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    await recordExport();
    rerender();
  }

  async function copySnippet(baseName: string, rerender: () => void, button: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(buildPictureSnippet({ name: baseName }));
      await recordExport();
      rerender();
    } catch {
      flashLabel(button, 'copy failed');
    }
  }

  async function suggestAlt(src: string, altBox: HTMLElement, gen: number): Promise<void> {
    altBox.replaceChildren(h('div', { class: 'oalt omuted', text: 'asking for alt text...' }));
    const result = await requestAlt(src);
    if (gen !== generation) return;
    if (!result.ok) {
      const { text } = describeError(result);
      altBox.replaceChildren(h('div', { class: 'oalt omuted', text }));
      return;
    }
    const textarea = h('textarea', { rows: 2, value: result.value.alt, readOnly: true } as Props);
    const copyBtn = h('button', { class: 'obtn', type: 'button', text: 'copy alt' } as Props);
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(result.value.alt).then(
        () => {
          copyBtn.textContent = 'copied';
        },
        () => undefined
      );
    });
    altBox.replaceChildren(
      h('div', { class: 'oalt' }, [h('div', { class: 'omuted', text: 'suggested alt' }), textarea, copyBtn])
    );
  }

  function cropsSection(src: string, gen: number): HTMLElement {
    const section = h('div', { class: 'osection' }, [h('span', { class: 'oeyebrow', text: 'smart crop 240x240' })]);
    const grid = h('div', { class: 'ocrops' });
    for (const fit of ['cover', 'face', 'auto'] as const) {
      const cell = h('div', { class: 'ocrop' });
      const slot = h('div', { class: 'oskel-crop' });
      cell.append(slot, h('div', { class: 'ocroplabel', text: fit }));
      grid.append(cell);
      void loadCrop(src, fit, slot, gen);
    }
    section.append(grid);
    return section;
  }

  async function loadCrop(src: string, fit: DemoTransformOpts['fit'], slot: HTMLElement, gen: number): Promise<void> {
    const result = await requestBytes(src, { w: 240, h: 240, fit, fmt: 'webp' });
    if (gen !== generation) return;
    if (!result.ok) {
      cropFailed(slot);
      return;
    }
    try {
      const bitmap = await createImageBitmap(payloadToBlob(result.value));
      try {
        if (gen !== generation) return;
        const canvas = h('canvas', { width: bitmap.width, height: bitmap.height } as Props);
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        slot.replaceWith(canvas);
      } finally {
        bitmap.close(); // release the decoded bitmap on every path, including the gen bail
      }
    } catch {
      cropFailed(slot);
    }
  }

  /** Swap a crop skeleton to the static failed state (no pulse on a dead end). */
  function cropFailed(slot: HTMLElement): void {
    slot.className = 'ostate';
    slot.textContent = 'failed';
  }

  /** A spent demo replaces the panel with the wall; a transient failure just
   *  flashes the button so the preview the user is looking at stays put. */
  function handleExportError(
    result: Extract<DemoResult<unknown>, { ok: false }>,
    gen: number,
    button: HTMLButtonElement
  ): void {
    if (gen !== generation) return;
    const { text, wall } = describeError(result);
    if (wall) body.replaceChildren(wallBox(text));
    else flashLabel(button, 'failed');
  }

  return { open };
}

/** Briefly swap a button's label to signal a transient failure, then restore. */
function flashLabel(button: HTMLButtonElement, message: string): void {
  const original = button.textContent ?? '';
  button.textContent = message;
  setTimeout(() => {
    button.textContent = original;
  }, 1_500);
}

function gateLink(): HTMLAnchorElement {
  return h('a', {
    class: 'obtn ogate',
    href: GATE_CTA_URL,
    target: '_blank',
    rel: 'noreferrer',
    text: 'create a free project to keep shipping these'
  } as Props);
}

function wallBox(text: string): HTMLElement {
  const link = h('a', { href: WALL_CTA_URL, target: '_blank', rel: 'noreferrer', text: 'auraimage.ai' } as Props);
  return h('div', { class: 'owall' }, [h('div', { text }), link]);
}

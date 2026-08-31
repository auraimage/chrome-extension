// The optimize panel: a modal card, rendered into the overlay's shadow root, that
// turns a badge's "optimize" click into real edge proof. It calls the Demo edge
// (through the background proxy) for before/after stats, a blurhash preview, three
// smart-crop thumbnails, downloadable avif/webp, a copy-ready <picture> snippet,
// and AI alt text. Seeing is free; the export controls pass through the gate and
// the `exports` row says how many free ones are left. Every call has its own
// loading and error state: a spent demo shows the inline wall, a transient failure
// offers `retry`. Styling mirrors overlay.ts: hue-260 mono, the shared loss / win /
// accent tones, no shadows at rest. Closing hands focus back to the badge that
// opened it.
import { formatBytes } from '../shared/format';
import {
  FREE_EXPORT_ALLOWANCE,
  GATE_CTA_URL,
  WALL_CTA_URL,
  getExportsUsed,
  isGated,
  recordExport,
  remainingExports
} from '../shared/gate';
import { buildPictureSnippet } from '../shared/snippet';
import type { DemoResult, DemoStats, DemoTransformOpts } from '../shared/types';
import { payloadToBlob, requestAlt, requestBytes, requestStats } from './demo-bridge';
import { buildComparison } from './optimize-model';
import { ensureOverlayHost } from './overlay';
import { decode } from 'blurhash';

export interface OptimizePanel {
  /** Open on an image; `opener` (the badge chip) gets focus back on close. */
  open(src: string, opener?: HTMLElement | null): void;
}

const STYLE_ID = 'aura-optimize-style';

/** How long a button wears its copied/saved/failed label before reverting. */
const FLASH_MS = 1500;

const STYLE = `
  .obk {
    --popover: oklch(0.985 0.003 260);
    --fg: oklch(0.12 0.005 260);
    --fg-hover: oklch(0.24 0.008 260);
    --muted: oklch(0.45 0.005 260);
    --border: oklch(0.91 0.003 260);
    --border-strong: oklch(0.78 0.005 260);
    --hover: oklch(0.94 0.003 260);
    --track: oklch(0.94 0.004 260);
    --bar-neutral: oklch(0.78 0.005 260);
    --win: oklch(0.47 0.13 152);
    --win-soft: oklch(0.95 0.04 152);
    --loss: oklch(0.48 0.19 27);
    --loss-soft: oklch(0.95 0.025 27);
    --accent: oklch(0.5 0.16 255);
    --ring: var(--accent);
    position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    padding: 24px; background: oklch(0 0 0 / 0.45); pointer-events: auto;
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    .obk {
      --popover: oklch(0.17 0.005 260);
      --fg: oklch(0.95 0.003 260);
      --fg-hover: oklch(0.88 0.003 260);
      --muted: oklch(0.65 0.005 260);
      --border: oklch(0.28 0.005 260);
      --border-strong: oklch(0.45 0.005 260);
      --hover: oklch(0.24 0.005 260);
      --track: oklch(0.25 0.005 260);
      --bar-neutral: oklch(0.42 0.005 260);
      --win: oklch(0.74 0.13 152);
      --win-soft: oklch(0.25 0.05 152);
      --loss: oklch(0.72 0.16 27);
      --loss-soft: oklch(0.25 0.05 27);
      --accent: oklch(0.72 0.14 255);
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
    width: 36px; height: 36px; object-fit: cover; flex: 0 0 auto;
    border: 1px solid var(--border); border-radius: 6px; background: var(--hover);
  }
  .oheadtext { flex: 1; min-width: 0; }
  .oeyebrow { font-size: 11px; font-weight: 500; letter-spacing: 0.04em; color: var(--muted); }
  .otitle { margin: 1px 0 0; font-size: 13px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.35; word-break: break-all; }
  .osrc { margin-top: 1px; color: var(--muted); font-size: 11px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .obtn {
    padding: 5px 12px; font: inherit; font-size: 11px; font-weight: 500; line-height: 1.5; color: var(--fg);
    background: transparent; border: 1px solid var(--border); border-radius: 9999px; cursor: pointer;
  }
  .obtn:disabled { opacity: 0.5; cursor: default; }
  .obtn:hover:not(:disabled) { background: var(--hover); border-color: var(--border-strong); }
  .obtn.primary { color: var(--popover); background: var(--fg); border-color: var(--fg); }
  .obtn.primary:hover:not(:disabled) { background: var(--fg-hover); border-color: var(--fg-hover); }
  /* Feedback flashes: copied/saved in the win tone, a failure in the loss tone. */
  .obtn.is-win { color: var(--win); background: var(--win-soft); border-color: var(--win); }
  .obtn.is-loss { color: var(--loss); background: var(--loss-soft); border-color: var(--loss); }
  .obtn.primary.is-win { color: var(--popover); background: var(--win); border-color: var(--win); }
  .obtn.primary.is-loss { color: var(--popover); background: var(--loss); border-color: var(--loss); }
  .obtn:focus-visible, .ogate:focus-visible, .owall a:focus-visible, .oalt textarea:focus-visible, .ogate-row a:focus-visible {
    outline: 2px solid var(--ring); outline-offset: 2px;
  }
  .oclose { padding: 3px 9px; }
  .osection { margin-top: 12px; }
  /* The proof block: headline saving, then one measured bar per encoding.
     Tones are semantic only: loss is bytes paid today, win is a real saving,
     neutral means the re-encode does not help. */
  .oheadline { margin-top: 14px; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
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
  /* Exports: a label + the free-export counter, then the gated controls. */
  .oexports { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
  .oexports-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .ocount { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .ocount.spent { color: var(--loss); }
  .orow { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .ogate-row {
    display: block; margin-top: 8px; padding: 8px 10px;
    font-size: 11px; line-height: 1.5; color: var(--fg);
    background: var(--hover); border-radius: 6px;
  }
  .ogate-row a, .ogate { color: var(--fg); text-decoration: underline; text-underline-offset: 2px; }
  .oalt-hint { margin-top: 6px; font-size: 10px; color: var(--muted); }
  .ocrops { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
  .ocrop { text-align: center; }
  .ocrop canvas { display: block; width: 100%; height: 96px; object-fit: cover; border: 1px solid var(--border); border-radius: 4px; background: var(--hover); }
  /* A failed crop keeps the cell's shape (canvas 96px + 1px borders) so the labels stay level. */
  .ocrop .ostate { min-height: 98px; border: 1px dashed var(--border); border-radius: 4px; }
  .ocroplabel { margin-top: 4px; font-size: 10px; color: var(--muted); }
  .ostate { min-height: 96px; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 11px; }
  /* A transient failure: the message plus a retry, stacked and centered. */
  .oretry { flex-direction: column; gap: 10px; }
  .omuted { color: var(--muted); font-size: 11px; }
  /* Loading skeleton: same grid as the proof block so the card doesn't jump. */
  .oskel { display: grid; grid-template-columns: max-content 1fr max-content; gap: 12px 10px; align-items: center; margin-top: 18px; min-height: 78px; align-content: start; }
  .oskel-line { height: 8px; border-radius: 3px; background: var(--track); }
  .oskel-label { width: 52px; }
  .oskel-size { width: 40px; }
  .oskel-crop { height: 96px; border-radius: 4px; background: var(--track); }
  .oalt { margin-top: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; }
  .oalt textarea { width: 100%; box-sizing: border-box; margin: 6px 0 8px; padding: 6px 8px; font: inherit; font-size: 11px; line-height: 1.5; color: var(--fg); background: transparent; border: 1px solid var(--border); border-radius: 4px; resize: vertical; }
  /* The wall: the demo is spent for today. Loss-toned message, plain link. */
  .owall { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 11px; line-height: 1.5; }
  .owall-text { color: var(--loss); }
  .owall a { color: var(--fg); text-decoration: underline; text-underline-offset: 2px; }
  @media (prefers-reduced-motion: no-preference) {
    .obtn { transition: background 120ms cubic-bezier(0.2, 0.8, 0.2, 1), border-color 120ms cubic-bezier(0.2, 0.8, 0.2, 1), color 120ms cubic-bezier(0.2, 0.8, 0.2, 1); }
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

function hostLabel(src: string): string {
  try {
    return new URL(src).hostname;
  } catch {
    return src;
  }
}

/** The image's file name as shown in the panel title: last path segment, decoded. */
function imageFileName(src: string): string {
  if (src.startsWith('data:')) return 'inline image';
  try {
    const last = new URL(src).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : 'image';
  } catch {
    return 'image';
  }
}

/** Extension-less name for downloads and the <picture> snippet. */
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
      return { text: 'Alt suggestions are not configured on this edge.', wall: false };
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
  const title = h('h2', { class: 'otitle' });
  const srcLine = h('div', { class: 'osrc' });
  const closeBtn = h('button', { class: 'obtn oclose', type: 'button', text: 'close' } as Props);
  // The page has this image decoded already, so the thumbnail is a cache read
  // that anchors "which image am I optimizing" without an extra edge call.
  const thumb = h('img', { class: 'othumb', alt: '' } as Props);
  thumb.setAttribute('aria-hidden', 'true');
  thumb.addEventListener('error', () => {
    thumb.style.display = 'none';
  });
  const headText = h('div', { class: 'oheadtext' }, [
    h('span', { class: 'oeyebrow', text: 'optimize' }),
    title,
    srcLine
  ]);
  const head = h('div', { class: 'ohead' }, [thumb, headText, closeBtn]);
  card.append(head, body);
  const backdrop = h('div', { class: 'obk' }, [card]);
  shadow.append(backdrop);

  // Each open() bumps the generation so a late response from a previous image
  // (or a since-closed panel) can be dropped instead of rendered into this one.
  let generation = 0;
  // The badge chip (or nothing, from the context menu) that focus returns to.
  let opener: HTMLElement | null = null;

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }

  function close(): void {
    generation++;
    backdrop.style.display = 'none';
    body.replaceChildren();
    document.removeEventListener('keydown', onKeydown, true);
    const target = opener;
    opener = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });

  function open(src: string, from: HTMLElement | null = null): void {
    const gen = ++generation;
    opener = from;
    const fileName = imageFileName(src);
    title.textContent = fileName;
    srcLine.textContent = hostLabel(src);
    card.setAttribute('aria-label', `optimize ${fileName}`);
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

    startStats(src, gen);
  }

  /** Show the skeleton and ask the edge; shared by the first load and `retry`. */
  function startStats(src: string, gen: number): void {
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
      if (wall) {
        body.replaceChildren(wallBox(text));
        return;
      }
      // Transient: keep the panel, offer to try again.
      const retry = h('button', { class: 'obtn', type: 'button', text: 'retry' } as Props);
      retry.addEventListener('click', () => startStats(src, gen));
      body.replaceChildren(h('div', { class: 'osection ostate oretry' }, [h('div', { text }), retry]));
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

    const exports = h('div', { class: 'oexports' });
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

  /** `3 of 3 free left` while exports remain, `3 of 3 free used` once spent. */
  function countLabel(used: number): string {
    return isGated(used)
      ? `${FREE_EXPORT_ALLOWANCE} of ${FREE_EXPORT_ALLOWANCE} free used`
      : `${remainingExports(used)} of ${FREE_EXPORT_ALLOWANCE} free left`;
  }

  async function renderExportControls(
    container: HTMLElement,
    src: string,
    baseName: string,
    altBox: HTMLElement,
    gen: number
  ): Promise<void> {
    const used = await getExportsUsed();
    if (gen !== generation) return;
    container.replaceChildren();

    const count = h('span', { class: `ocount${isGated(used) ? ' spent' : ''}`, text: countLabel(used) });
    container.append(h('div', { class: 'oexports-head' }, [h('span', { class: 'oeyebrow', text: 'exports' }), count]));

    const rerender = () => void renderExportControls(container, src, baseName, altBox, gen);
    /** After a successful export: bump the counter now, swap to the gate row once the flash has been read. */
    const afterExport = async (): Promise<void> => {
      const next = await recordExport();
      if (gen !== generation) return;
      count.textContent = countLabel(next);
      count.classList.toggle('spent', isGated(next));
      if (isGated(next)) setTimeout(rerender, FLASH_MS);
    };

    if (isGated(used)) {
      container.append(gateRow());
    } else {
      const exportControl = (
        label: string,
        primary: boolean,
        run: (button: HTMLButtonElement) => Promise<boolean>
      ): HTMLButtonElement => {
        const button = h('button', { class: primary ? 'obtn primary' : 'obtn', type: 'button', text: label } as Props);
        button.addEventListener('click', () => {
          void (async () => {
            button.disabled = true;
            const exported = await run(button);
            button.disabled = false;
            if (exported) await afterExport();
          })();
        });
        return button;
      };
      container.append(
        h('div', { class: 'orow' }, [
          exportControl('download avif', true, (button) => downloadImage(src, baseName, 'avif', gen, button)),
          exportControl('download webp', false, (button) => downloadImage(src, baseName, 'webp', gen, button)),
          exportControl('copy <picture>', false, (button) => copySnippet(baseName, button))
        ])
      );
    }

    // Alt text is never gated, and it is the one call that leaves AuraImage.
    const altButton = h('button', { class: 'obtn', type: 'button', text: 'suggest alt text' } as Props);
    altButton.addEventListener('click', () => {
      altButton.disabled = true;
      void suggestAlt(src, altBox, gen).finally(() => {
        altButton.disabled = false;
      });
    });
    container.append(
      h('div', { class: 'orow' }, [altButton]),
      h('div', { class: 'oalt-hint', text: 'alt text: the resized image goes to Google Gemini' })
    );
  }

  /** Download one encode; true when the bytes were saved (an export to record). */
  async function downloadImage(
    src: string,
    baseName: string,
    fmt: 'avif' | 'webp',
    gen: number,
    button: HTMLButtonElement
  ): Promise<boolean> {
    const label = button.textContent ?? `download ${fmt}`;
    button.textContent = 'downloading...';
    const result = await requestBytes(src, { fmt });
    if (gen !== generation) return false;
    button.textContent = label; // restore before a wall/failed flash
    if (!result.ok) {
      handleExportError(result, gen, button);
      return false;
    }
    const url = URL.createObjectURL(payloadToBlob(result.value));
    const anchor = h('a', { href: url, download: `${baseName}.${fmt}` } as Props);
    anchor.click();
    // Defer the revoke: revoking synchronously can cancel an in-flight download.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    flashLabel(button, 'saved', 'win');
    return true;
  }

  /** Copy the <picture> snippet; true when it reached the clipboard. */
  async function copySnippet(baseName: string, button: HTMLButtonElement): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(buildPictureSnippet({ name: baseName }));
      flashLabel(button, 'copied', 'win');
      return true;
    } catch {
      flashLabel(button, 'copy failed', 'loss');
      return false;
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
        () => flashLabel(copyBtn, 'copied', 'win'),
        () => flashLabel(copyBtn, 'copy failed', 'loss')
      );
    });
    altBox.replaceChildren(
      h('div', { class: 'oalt' }, [h('div', { class: 'oeyebrow', text: 'suggested alt' }), textarea, copyBtn])
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
    else flashLabel(button, 'failed', 'loss');
  }

  return { open };
}

/**
 * Briefly swap a button's label to confirm or fail an action, tinted in the win
 * or loss tone, then restore. Re-entrant: a second flash keeps the original label.
 */
function flashLabel(button: HTMLButtonElement, message: string, tone: 'win' | 'loss'): void {
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

/** The single row that replaces the export controls once the allowance is spent. */
function gateRow(): HTMLElement {
  return h('div', { class: 'ogate-row' }, [
    `${FREE_EXPORT_ALLOWANCE} of ${FREE_EXPORT_ALLOWANCE} free exports used. `,
    h('a', { href: GATE_CTA_URL, target: '_blank', rel: 'noreferrer', text: 'create a free project' } as Props),
    ' to keep shipping these.'
  ]);
}

function wallBox(text: string): HTMLElement {
  const link = h('a', { href: WALL_CTA_URL, target: '_blank', rel: 'noreferrer', text: 'auraimage.ai' } as Props);
  return h('div', { class: 'owall' }, [h('div', { class: 'owall-text', text }), link]);
}

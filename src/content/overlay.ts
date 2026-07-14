// Shadow-DOM overlay: one <aura-xray-root> host holds a badge chip per rendered
// image, positioned over each img's top-left. Visibility is driven by an
// IntersectionObserver; a single rAF loop repositions the currently-visible
// badges on scroll/resize. Styling follows DESIGN.md: hue-260 oklch neutrals,
// 1px borders, 0.75rem panel radius, ui-monospace 11px, no shadows at rest,
// dark scheme via prefers-color-scheme, transitions only when motion is allowed.
import type { ImageFindings } from '../shared/types';
import { buildBadgeLabel, dimsLine, flagLines, savingLine, sizeNoteLine } from './badge-label';

export interface AnalyzedImage {
  findings: ImageFindings;
  elements: HTMLImageElement[];
}

export interface OverlayController {
  /** Rebuild the badge set from the latest analysis. */
  render(items: AnalyzedImage[]): void;
  /** Site mute: hide the whole overlay host, switcher included. */
  setMuted(muted: boolean): void;
  /** Badge switch: hide/show badges but keep the on-page switcher reachable. */
  setBadgesEnabled(enabled: boolean): void;
  destroy(): void;
}

const HOST_TAG = 'aura-xray-root';
const STYLE_ID = 'aura-xray-style';

const STYLE = `
  .root {
    --card: oklch(0.985 0.003 260);
    --popover: oklch(0.985 0.003 260);
    --fg: oklch(0.12 0.005 260);
    --muted: oklch(0.45 0.005 260);
    --border: oklch(0.91 0.003 260);
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    .root {
      --card: oklch(0.17 0.005 260);
      --popover: oklch(0.17 0.005 260);
      --fg: oklch(0.95 0.003 260);
      --muted: oklch(0.65 0.005 260);
      --border: oklch(0.28 0.005 260);
    }
  }
  /* padding-bottom bridges the chip and the panel so the hover region is
     continuous: a margin gap would drop :hover as the pointer crosses it. */
  .wrap { position: absolute; top: 0; left: 0; padding-bottom: 4px; pointer-events: auto; will-change: transform; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 6px; font-size: 11px; line-height: 1;
    color: var(--fg); background: var(--card);
    border: 1px solid var(--border); border-radius: 0.375rem;
    white-space: nowrap; cursor: default;
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--fg); flex: 0 0 auto; }
  .panel {
    display: none; position: absolute; top: 100%; left: 0;
    min-width: 180px; max-width: 280px; padding: 8px 10px;
    color: var(--fg); background: var(--popover);
    border: 1px solid var(--border); border-radius: 0.75rem; font-size: 11px; line-height: 1.5;
  }
  .wrap:hover .panel { display: block; }
  .row { color: var(--fg); }
  .row.muted { color: var(--muted); }
  .flags { margin: 4px 0 0; padding: 0; list-style: none; }
  .flags li { color: var(--muted); }
  .save { margin-top: 4px; color: var(--fg); }
  .optimize {
    margin-top: 8px; padding: 4px 12px; font: inherit; font-size: 11px;
    color: var(--fg); background: transparent;
    border: 1px solid var(--border); border-radius: 9999px; cursor: pointer;
  }
  @media (prefers-reduced-motion: no-preference) {
    .optimize { transition: background 120ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  }
  .optimize:hover { background: var(--card); }
  /* The Badge switch pill. Lives outside .badges so it stays reachable when
     badges are hidden; collapsed to a small dot in the off state, expanding on
     hover so the page keeps only a minimal permanent artifact. */
  .switch {
    position: fixed; right: 12px; bottom: 12px;
    display: inline-flex; align-items: center;
    padding: 4px 8px; font: inherit; font-size: 11px; line-height: 1;
    color: var(--fg); background: var(--card);
    border: 1px solid var(--border); border-radius: 9999px;
    cursor: pointer; pointer-events: auto;
  }
  .switch.off { width: 12px; height: 12px; padding: 0; }
  .switch.off .switch-label { display: none; }
  .switch.off:hover { width: auto; height: auto; padding: 4px 8px; }
  .switch.off:hover .switch-label { display: inline; }
`;

function makeText(cls: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  return el;
}

export function createOverlay(
  onOptimize: (src: string) => void,
  onBadgesToggle: (next: boolean) => void
): OverlayController {
  const host = ensureOverlayHost();
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  // Guard by our own id: the optimize panel shares this shadow root and injects
  // its own <style>, so a generic `querySelector('style')` would match the
  // panel's and skip the overlay's CSS (disjoint selectors), leaving badges
  // unstyled. Never rely on which surface constructs first.
  if (!shadow.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    shadow.append(style);
  }
  let root = shadow.querySelector<HTMLElement>('.root');
  if (!root) {
    root = document.createElement('div');
    root.className = 'root';
    shadow.append(root);
  }

  // Badges live in their own container so the Badge switch (its sibling
  // inside the styled root) survives hiding them.
  const existingBadges = root.querySelector<HTMLElement>('.badges');
  const container = existingBadges ?? document.createElement('div');
  if (!existingBadges) {
    container.className = 'badges';
    root.append(container);
  }

  // img → its badge wrap. A Map keeps the per-frame reposition and the
  // IntersectionObserver callback O(visible) instead of scanning every badge.
  const byImg = new Map<HTMLImageElement, HTMLElement>();
  const visible = new Set<HTMLImageElement>();
  let badgesOn = true;
  let rafId = 0;

  const switchLabel = document.createElement('span');
  switchLabel.className = 'switch-label';
  const switchButton = document.createElement('button');
  switchButton.type = 'button';
  switchButton.className = 'switch';
  switchButton.style.display = 'none'; // shown once the page has badged images
  switchButton.append(switchLabel);
  switchButton.addEventListener('click', () => {
    // Apply locally for instant feedback; persisting the Badge switch echoes
    // the same state back through storage.onChanged (and into other tabs).
    const next = !badgesOn;
    setBadgesEnabled(next);
    onBadgesToggle(next);
  });
  root.append(switchButton);

  function syncSwitch(): void {
    switchButton.style.display = byImg.size > 0 ? '' : 'none';
    switchButton.classList.toggle('off', !badgesOn);
    switchButton.setAttribute('aria-pressed', String(badgesOn));
    switchButton.title = badgesOn ? 'hide AuraImage badges on all sites' : 'show AuraImage badges on all sites';
    switchLabel.textContent = badgesOn ? `x-ray · ${byImg.size}` : 'x-ray';
  }

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const img = entry.target as HTMLImageElement;
      const wrap = byImg.get(img);
      if (!wrap) continue;
      if (entry.isIntersecting) visible.add(img);
      else {
        visible.delete(img);
        wrap.style.display = 'none';
      }
    }
  });

  function positionAll(): void {
    if (badgesOn) {
      for (const img of visible) {
        const wrap = byImg.get(img);
        if (!wrap) continue;
        const rect = img.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          wrap.style.display = 'none';
          continue;
        }
        wrap.style.display = '';
        wrap.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
      }
    }
    rafId = requestAnimationFrame(positionAll);
  }

  function clear(): void {
    io.disconnect();
    visible.clear();
    for (const wrap of byImg.values()) wrap.remove();
    byImg.clear();
  }

  function buildBadge(img: HTMLImageElement, findings: ImageFindings): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    const chip = document.createElement('div');
    chip.className = 'chip';
    const label = buildBadgeLabel(findings);
    if (label.warn) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.title = 'has flags';
      chip.append(dot);
    }
    chip.append(document.createTextNode(label.text));
    wrap.append(chip);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.append(makeText('row muted', dimsLine(findings)));

    const sizeNote = sizeNoteLine(findings);
    if (sizeNote) panel.append(makeText('row muted', sizeNote));

    const flags = flagLines(findings);
    if (flags.length > 0) {
      const list = document.createElement('ul');
      list.className = 'flags';
      for (const line of flags) {
        const li = document.createElement('li');
        li.textContent = line;
        list.append(li);
      }
      panel.append(list);
    }

    const saving = savingLine(findings);
    if (saving) panel.append(makeText('save', saving));

    const button = document.createElement('button');
    button.className = 'optimize';
    button.type = 'button';
    button.textContent = 'optimize';
    button.addEventListener('click', () => onOptimize(findings.facts.currentSrc));
    panel.append(button);

    wrap.append(panel);
    return wrap;
  }

  function render(items: AnalyzedImage[]): void {
    clear();
    for (const item of items) {
      for (const img of item.elements) {
        const wrap = buildBadge(img, item.findings);
        wrap.style.display = 'none';
        container.append(wrap);
        byImg.set(img, wrap);
        io.observe(img);
      }
    }
    if (rafId === 0) rafId = requestAnimationFrame(positionAll);
    syncSwitch();
  }

  function setMuted(muted: boolean): void {
    host.style.display = muted ? 'none' : '';
  }

  function setBadgesEnabled(enabled: boolean): void {
    badgesOn = enabled;
    container.style.display = enabled ? '' : 'none';
    syncSwitch();
  }

  function destroy(): void {
    if (rafId !== 0) cancelAnimationFrame(rafId);
    rafId = 0;
    clear();
    host.remove();
  }

  return {
    render,
    setMuted,
    setBadgesEnabled,
    destroy
  };
}

/** Find or create the single overlay host, appended once to the document root.
 *  Shared with the optimize panel so both render into the same shadow root. */
export function ensureOverlayHost(): HTMLElement {
  const existing = document.querySelector<HTMLElement>(HOST_TAG);
  if (existing) return existing;
  const host = document.createElement(HOST_TAG);
  host.style.cssText = 'position:fixed;inset:0;margin:0;padding:0;border:0;pointer-events:none;z-index:2147483647;';
  document.documentElement.append(host);
  return host;
}

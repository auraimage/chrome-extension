// Shadow-DOM overlay: one <aura-xray-root> host holds a badge chip per rendered
// image, positioned over each img's top-left. Visibility is driven by an
// IntersectionObserver; a single rAF loop repositions the currently-visible
// badges on scroll/resize. Each chip is a button that reveals a detail panel:
// hover previews it (with open/close grace so it never flickers), click or
// keyboard focus pins it, and the panel flips above the chip or clamps
// horizontally so it never clips at a viewport edge. Styling follows DESIGN.md:
// hue-260 oklch neutrals, 1px borders, 0.75rem panel radius, ui-monospace 11px,
// win/loss semantic tones shared with the optimize panel, a shadow only on the
// floating panel, dark scheme via prefers-color-scheme, transitions only when
// motion is allowed.
import type { ImageFindings } from '../shared/types';
import { buildBadgeLabel, buildPanelModel } from './badge-label';
import { buildSwitchModel } from './switch-model';

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

/** Hover intent: opening waits out a cursor sweep, closing forgives a diagonal
 *  exit toward the panel. */
const OPEN_DELAY_MS = 70;
const CLOSE_DELAY_MS = 160;
/** Chip-to-panel gap and the minimum air kept between panel and viewport edge. */
const PANEL_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

const STYLE = `
  .root {
    --card: oklch(0.985 0.003 260);
    --popover: oklch(0.985 0.003 260);
    --fg: oklch(0.12 0.005 260);
    --fg-hover: oklch(0.24 0.008 260);
    --muted: oklch(0.45 0.005 260);
    --border: oklch(0.91 0.003 260);
    --border-strong: oklch(0.78 0.005 260);
    --win: oklch(0.47 0.14 152);
    --loss: oklch(0.48 0.19 27);
    --ring: oklch(0.55 0.18 255);
    --panel-shadow: 0 2px 6px oklch(0.12 0.005 260 / 0.06), 0 14px 32px oklch(0.12 0.005 260 / 0.12);
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    .root {
      --card: oklch(0.17 0.005 260);
      --popover: oklch(0.17 0.005 260);
      --fg: oklch(0.95 0.003 260);
      --fg-hover: oklch(0.88 0.003 260);
      --muted: oklch(0.65 0.005 260);
      --border: oklch(0.28 0.005 260);
      --border-strong: oklch(0.45 0.005 260);
      --win: oklch(0.74 0.13 152);
      --loss: oklch(0.72 0.16 27);
      --ring: oklch(0.65 0.18 255);
      --panel-shadow: 0 2px 6px oklch(0 0 0 / 0.35), 0 14px 32px oklch(0 0 0 / 0.5);
    }
  }
  .wrap { position: absolute; top: 0; left: 0; pointer-events: auto; will-change: transform; }
  .wrap.open { z-index: 1; }
  .chip {
    appearance: none; margin: 0;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 6px; font: inherit; font-size: 11px; line-height: 1;
    color: var(--fg); background: var(--card);
    border: 1px solid var(--border); border-radius: 0.375rem;
    white-space: nowrap; cursor: pointer;
  }
  .chip:hover, .wrap.open .chip { border-color: var(--border-strong); }
  .chip:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--loss); flex: 0 0 auto; }
  /* The slot hangs the panel off the chip and its padding bridges the gap, so
     the hover region is continuous: a margin gap would drop :hover as the
     pointer crosses it. .up flips it above the chip when the viewport bottom
     is too close; place() sets an inline left offset to clamp horizontally. */
  .slot { position: absolute; top: 100%; left: 0; padding-top: ${PANEL_GAP_PX}px; }
  .wrap.up .slot { top: auto; bottom: 100%; padding-top: 0; padding-bottom: ${PANEL_GAP_PX}px; }
  /* Kept laid out while hidden (visibility, not display) so place() can
     measure it before opening, and so the entrance can transition. */
  .panel {
    width: max-content; min-width: 216px; max-width: 300px;
    padding: 12px; color: var(--fg); background: var(--popover);
    border: 1px solid var(--border); border-radius: 0.75rem;
    box-shadow: var(--panel-shadow);
    font-size: 11px; line-height: 1.5;
    opacity: 0; visibility: hidden; pointer-events: none;
    transform: translateY(-${PANEL_GAP_PX}px);
  }
  .wrap.up .panel { transform: translateY(${PANEL_GAP_PX}px); }
  .wrap.open .panel { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(0); }
  .phead { display: flex; align-items: baseline; gap: 6px; }
  .pformat { font-size: 12px; font-weight: 700; letter-spacing: -0.01em; }
  .psize { font-size: 12px; font-variant-numeric: tabular-nums; }
  .plcp {
    align-self: center; padding: 1px 5px; font-size: 10px; line-height: 1.4;
    color: var(--muted); border: 1px solid var(--border); border-radius: 9999px;
  }
  .pstatus { margin-left: auto; padding-left: 10px; }
  .pstatus.win { color: var(--win); }
  .pstatus.loss { color: var(--loss); }
  .pfacts { display: grid; grid-template-columns: max-content 1fr; gap: 2px 16px; margin: 8px 0 0; }
  .pfacts dt { color: var(--muted); }
  .pfacts dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .pnote { margin-top: 6px; color: var(--muted); }
  .pflags { margin: 10px 0 0; padding: 8px 0 0; list-style: none; border-top: 1px solid var(--border); display: grid; gap: 4px; }
  .pflags li { display: flex; align-items: center; gap: 7px; }
  .pflags .fdot { width: 5px; height: 5px; border-radius: 50%; background: var(--loss); flex: 0 0 auto; }
  .psave { margin-top: 8px; color: var(--win); font-weight: 600; font-variant-numeric: tabular-nums; }
  .pcta {
    appearance: none; display: block; width: 100%; margin: 10px 0 0; padding: 6px 12px;
    font: inherit; font-size: 11px; font-weight: 500; letter-spacing: 0.04em; line-height: 1.6;
    color: var(--card); background: var(--fg);
    border: 1px solid var(--fg); border-radius: 9999px; cursor: pointer;
  }
  .pcta:hover { background: var(--fg-hover); border-color: var(--fg-hover); }
  .pcta:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  @media (prefers-reduced-motion: no-preference) {
    .chip { transition: border-color 120ms cubic-bezier(0.2, 0.8, 0.2, 1); }
    .pcta { transition: background 120ms cubic-bezier(0.2, 0.8, 0.2, 1), border-color 120ms cubic-bezier(0.2, 0.8, 0.2, 1); }
    /* visibility waits out the fade on close; zero delay on open. */
    .panel {
      transition: opacity 140ms cubic-bezier(0.22, 1, 0.36, 1), transform 140ms cubic-bezier(0.22, 1, 0.36, 1),
        visibility 0s linear 140ms;
    }
    .wrap.open .panel { transition-delay: 0s; }
  }
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

function makeText(tag: string, cls: string, text: string): HTMLElement {
  const el = document.createElement(tag);
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
  // Mirrors Site mute so the switch model can express the muted state; the host
  // element is hidden separately by setMuted().
  let mutedNow = false;
  let rafId = 0;

  // At most one panel is pinned at a time; these document-level listeners
  // dismiss it from outside the shadow root (click elsewhere, Escape).
  let pinnedWrap: HTMLElement | null = null;
  let unpinCurrent: (() => void) | null = null;

  function onDocPointerDown(event: PointerEvent): void {
    if (pinnedWrap && !event.composedPath().includes(pinnedWrap)) unpinCurrent?.();
  }
  function onDocKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && pinnedWrap) unpinCurrent?.();
  }
  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener('keydown', onDocKeydown, true);

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
    const model = buildSwitchModel({
      badgeCount: byImg.size,
      badgesEnabled: badgesOn,
      muted: mutedNow,
      hostname: location.hostname
    });
    switchButton.style.display = model.visible ? '' : 'none';
    switchButton.classList.toggle('off', model.collapsed);
    switchButton.setAttribute('aria-pressed', String(!model.collapsed));
    switchButton.setAttribute('aria-label', model.ariaLabel);
    switchButton.title = model.ariaLabel;
    switchLabel.textContent = model.label;
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
    pinnedWrap = null;
    unpinCurrent = null;
    for (const wrap of byImg.values()) wrap.remove();
    byImg.clear();
  }

  /** Hover previews the panel, click/tap or keyboard focus pins it, and
   *  place() keeps it inside the viewport (flip up, clamp horizontally). */
  function attachPanelBehavior(
    wrap: HTMLElement,
    chip: HTMLButtonElement,
    slot: HTMLElement,
    panel: HTMLElement
  ): void {
    let openTimer = 0;
    let closeTimer = 0;
    let pinned = false;

    function place(): void {
      const chipRect = chip.getBoundingClientRect();
      const panelW = panel.offsetWidth;
      const panelH = panel.offsetHeight;
      const fitsBelow = chipRect.bottom + PANEL_GAP_PX + panelH <= window.innerHeight - VIEWPORT_MARGIN_PX;
      const fitsAbove = chipRect.top - PANEL_GAP_PX - panelH >= VIEWPORT_MARGIN_PX;
      wrap.classList.toggle('up', !fitsBelow && fitsAbove);
      const maxLeft = window.innerWidth - VIEWPORT_MARGIN_PX - panelW;
      const clampedLeft = Math.max(VIEWPORT_MARGIN_PX, Math.min(chipRect.left, maxLeft));
      slot.style.left = `${Math.round(clampedLeft - chipRect.left)}px`;
    }

    function openNow(): void {
      clearTimeout(closeTimer);
      if (wrap.classList.contains('open')) return;
      place();
      wrap.classList.add('open');
      chip.setAttribute('aria-expanded', 'true');
    }

    function closeNow(): void {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      pinned = false;
      if (pinnedWrap === wrap) {
        pinnedWrap = null;
        unpinCurrent = null;
      }
      wrap.classList.remove('open');
      chip.setAttribute('aria-expanded', 'false');
    }

    wrap.addEventListener('mouseenter', () => {
      clearTimeout(closeTimer);
      openTimer = window.setTimeout(openNow, OPEN_DELAY_MS);
    });
    wrap.addEventListener('mouseleave', () => {
      clearTimeout(openTimer);
      if (!pinned) closeTimer = window.setTimeout(closeNow, CLOSE_DELAY_MS);
    });
    // Keyboard path: focusing the chip (or tabbing into the panel) opens;
    // leaving the badge closes unless pinned; Escape closes in place.
    wrap.addEventListener('focusin', openNow);
    wrap.addEventListener('focusout', (event) => {
      const next = event.relatedTarget;
      if (!pinned && !(next instanceof Node && wrap.contains(next))) closeNow();
    });
    wrap.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeNow();
    });
    chip.addEventListener('click', () => {
      if (pinned) {
        closeNow();
        return;
      }
      if (pinnedWrap && pinnedWrap !== wrap) unpinCurrent?.();
      pinned = true;
      pinnedWrap = wrap;
      unpinCurrent = closeNow;
      openNow();
    });
  }

  function buildPanel(findings: ImageFindings): HTMLElement {
    const model = buildPanelModel(findings);
    const panel = document.createElement('div');
    panel.className = 'panel';

    const head = document.createElement('div');
    head.className = 'phead';
    head.append(makeText('span', 'pformat', model.format));
    if (model.size) head.append(makeText('span', 'psize', model.size));
    if (model.isLcp) head.append(makeText('span', 'plcp', 'lcp'));
    head.append(makeText('span', `pstatus ${model.status.tone}`, model.status.text));
    panel.append(head);

    const facts = document.createElement('dl');
    facts.className = 'pfacts';
    for (const fact of model.facts) {
      facts.append(makeText('dt', '', fact.label), makeText('dd', '', fact.value));
    }
    panel.append(facts);

    if (model.note) panel.append(makeText('div', 'pnote', model.note));

    if (model.flags.length > 0) {
      const list = document.createElement('ul');
      list.className = 'pflags';
      for (const line of model.flags) {
        const li = document.createElement('li');
        const marker = document.createElement('span');
        marker.className = 'fdot';
        li.append(marker, document.createTextNode(line));
        list.append(li);
      }
      panel.append(list);
    }

    if (model.saving) panel.append(makeText('div', 'psave', model.saving));

    const button = document.createElement('button');
    button.className = 'pcta';
    button.type = 'button';
    button.textContent = 'optimize';
    button.addEventListener('click', () => onOptimize(findings.facts.currentSrc));
    panel.append(button);

    return panel;
  }

  function buildBadge(img: HTMLImageElement, findings: ImageFindings): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-expanded', 'false');
    const label = buildBadgeLabel(findings);
    if (label.warn) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.title = 'has flags';
      chip.append(dot);
    }
    chip.append(document.createTextNode(label.text));

    const slot = document.createElement('div');
    slot.className = 'slot';
    const panel = buildPanel(findings);
    slot.append(panel);

    wrap.append(chip, slot);
    attachPanelBehavior(wrap, chip, slot, panel);
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
    mutedNow = muted;
    host.style.display = muted ? 'none' : '';
    syncSwitch();
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
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    document.removeEventListener('keydown', onDocKeydown, true);
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

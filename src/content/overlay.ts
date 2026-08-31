// Shadow-DOM overlay: one <aura-xray-root> host holds a badge chip per rendered
// image, positioned over each img's top-left. Visibility is driven by an
// IntersectionObserver; a single rAF loop repositions the currently-visible
// badges on scroll/resize. Each chip is a button that reveals a detail panel:
// hover previews it (with open/close grace so it never flickers), click or
// keyboard focus pins it, and the panel flips above the chip or clamps
// horizontally so it never clips at a viewport edge. Styling follows DESIGN.md:
// hue-260 oklch neutrals, 1px borders, 0.75rem panel radius, ui-monospace 11px,
// the three semantic tones shared with the popup and the optimize panel (loss =
// a fired flag or bytes paid, win = a saving, accent = the LCP designation), a
// shadow only on the floating panel, dark scheme via prefers-color-scheme,
// transitions only when motion is allowed. The popup can also ask for a
// highlight: every image matching one flag (or the LCP image) gets a frame
// drawn over its box, the other badges recede, and a bar above the switcher
// steps through the matches and clears them.
import { buildHighlightBarModel, highlightTone, matchesHighlight, stepIndex } from '../shared/highlight';
import type { HighlightKey, ImageFindings } from '../shared/types';
import { buildBadgeLabel, buildPanelModel } from './badge-label';
import { type SwitchActionId, buildSwitchModel } from './switch-model';

export interface AnalyzedImage {
  findings: ImageFindings;
  elements: HTMLImageElement[];
}

export interface OverlayController {
  /** Rebuild the badge set from the latest analysis. */
  render(items: AnalyzedImage[]): void;
  /** Site mute: hide badges and the switcher. One-way from the page; the popup
   *  is the way back. The optimize panel stays reachable. */
  setMuted(muted: boolean): void;
  /** Badge switch: hide badges but keep the switcher reachable as a dot, so a
   *  global hide is always one press from being undone. */
  setBadgesEnabled(enabled: boolean): void;
  /** Frame every image matching `key` (null clears). Returns how many were framed. */
  setHighlight(key: HighlightKey | null): number;
  /** The key currently framed, so the popup opens in sync with the page. */
  getHighlight(): HighlightKey | null;
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
    --hover-bg: oklch(0.94 0.003 260);
    --win: oklch(0.47 0.13 152);
    --loss: oklch(0.48 0.19 27);
    --accent: oklch(0.5 0.16 255);
    --accent-soft: oklch(0.95 0.025 255);
    --ring: var(--accent);
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
      --hover-bg: oklch(0.24 0.005 260);
      --win: oklch(0.74 0.13 152);
      --loss: oklch(0.72 0.16 27);
      --accent: oklch(0.72 0.14 255);
      --accent-soft: oklch(0.27 0.06 255);
      --panel-shadow: 0 2px 6px oklch(0 0 0 / 0.35), 0 14px 32px oklch(0 0 0 / 0.5);
    }
  }
  .wrap { position: absolute; top: 0; left: 0; pointer-events: auto; will-change: transform; }
  .wrap.open { z-index: 1; }
  /* While a highlight is active the matching badges keep full weight and take
     the highlight's tone on their border; every other badge recedes. An open
     panel never dims out from under the pointer. */
  .badges.filtering .wrap:not(.hit):not(.open) { opacity: 0.35; }
  .wrap.hit .chip { border-color: var(--loss); }
  .root[data-tone='accent'] .wrap.hit .chip { border-color: var(--accent); }
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
  /* The LCP designation, on the chip and in the panel: accent-toned, because it
     marks the one image that matters most, not a defect. */
  .clcp, .plcp {
    padding: 0 5px; font-size: 9px; font-weight: 500; line-height: 1.6; letter-spacing: 0.04em;
    color: var(--accent); background: var(--accent-soft); border-radius: 9999px;
  }
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
  .plcp { align-self: center; font-size: 10px; }
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
    .chip, .switch { transition: border-color 120ms cubic-bezier(0.2, 0.8, 0.2, 1); }
    .wrap { transition: opacity 140ms cubic-bezier(0.22, 1, 0.36, 1); }
    .menu-item { transition: background 120ms cubic-bezier(0.2, 0.8, 0.2, 1); }
    .hbtn { transition: background 120ms cubic-bezier(0.2, 0.8, 0.2, 1), color 120ms cubic-bezier(0.2, 0.8, 0.2, 1); }
    .pcta { transition: background 120ms cubic-bezier(0.2, 0.8, 0.2, 1), border-color 120ms cubic-bezier(0.2, 0.8, 0.2, 1); }
    /* visibility waits out the fade on close; zero delay on open. */
    .panel {
      transition: opacity 140ms cubic-bezier(0.22, 1, 0.36, 1), transform 140ms cubic-bezier(0.22, 1, 0.36, 1),
        visibility 0s linear 140ms;
    }
    .wrap.open .panel { transition-delay: 0s; }
  }
  /* The dock pins the corner controls: the on-page switcher, and above it the
     highlight bar while a highlight is active. Stacked, not side by side, so
     neither pill has to match the other's height. Its z-index clears
     .wrap.open's 1: without it an open badge panel paints over the menu and
     wins hit-testing, silently swallowing a row's click. pointer-events stay
     off on the dock itself so the gap between the pills passes clicks through. */
  .dock {
    position: fixed; right: 12px; bottom: 12px; z-index: 2;
    display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
    pointer-events: none;
  }
  /* The on-page switcher. Lives outside .badges so it stays reachable when
     badges are hidden. The wrap is the menu's positioning anchor; the pill
     keeps the same weight it always had, per ADR 0024's minimal-permanent-
     artifact constraint. Only the caret is new. */
  .switch-wrap { position: relative; pointer-events: auto; }
  /* Site mute hides the ambient surfaces only. A highlight the user asked for
     from the popup still frames its images on a muted host, with the bar as
     the way to clear it. */
  .root.muted .badges, .root.muted .switch-wrap { display: none; }
  .switch {
    appearance: none; margin: 0;
    display: inline-flex; align-items: center; gap: 4px;
    padding: 4px 8px; font: inherit; font-size: 11px; line-height: 1;
    color: var(--fg); background: var(--card);
    border: 1px solid var(--border); border-radius: 9999px;
    cursor: pointer;
  }
  .switch:hover, .switch[aria-expanded='true'] { border-color: var(--border-strong); }
  .switch:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  /* The disclosure affordance: a statistic is never written with a chevron, so
     this is what reclassifies the pill from readout to control. */
  .caret { font-size: 9px; line-height: 1; color: var(--muted); }
  /* Collapsed dot: the minimal artifact left after a global hide, and the cheap
     way back. The drawn dot stays 12px per ADR 0024's permanent-artifact
     constraint, while a transparent ::before halo carries the 24x24 target
     WCAG 2.5.8 asks for -- this is the only route back from a global hide, so it
     must not be a 12px target. It expands on hover, on keyboard focus, and while
     its menu is open: the expansion is never the sole affordance (aria-label
     carries the name), and staying expanded while the menu is open stops the
     trigger collapsing out from under it as the cursor travels to a row.
     The halo is sized by inset, not by width/height: inset resolves against the
     button's padding box, so it grows with the button through the expanded
     states. A fixed 24x24 would re-centre on the larger box instead, and since
     the wrap is anchored right/bottom the button grows left and up -- collapsing
     the overhang on the two edges nearest the viewport corner to nothing, which
     is precisely where the pointer arrives. -7px, not -6px: the UA sheet makes
     button border-box, so the padding box is 10x10 and -6px would give 22x22. */
  .switch.off { position: relative; width: 12px; height: 12px; padding: 0; gap: 0; }
  .switch.off::before { content: ''; position: absolute; inset: -7px; }
  .switch.off .switch-label, .switch.off .caret { display: none; }
  .switch.off:is(:hover, :focus-visible, [aria-expanded='true']) {
    width: auto; height: auto; padding: 4px 8px; gap: 4px;
  }
  .switch.off:is(:hover, :focus-visible, [aria-expanded='true']) :is(.switch-label, .caret) { display: inline; }

  /* Opens upward and right-aligned from the fixed bottom-right anchor, so it
     never needs place()'s flip/clamp machinery. */
  .menu {
    position: absolute; right: 0; bottom: 100%; margin-bottom: 6px;
    min-width: 184px; max-width: 300px;
    padding: 6px; color: var(--fg); background: var(--popover);
    border: 1px solid var(--border); border-radius: 0.75rem;
    box-shadow: var(--panel-shadow);
    font-size: 11px; line-height: 1.5;
  }
  .menu[hidden] { display: none; }
  .menu-head {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    margin-bottom: 4px; padding: 2px 6px 6px;
    color: var(--muted); border-bottom: 1px solid var(--border);
  }
  .menu-help { color: var(--muted); text-decoration: none; }
  .menu-help:hover { color: var(--fg); }
  .menu-help:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .menu-item {
    appearance: none; display: block; width: 100%; margin: 0; padding: 5px 6px;
    font: inherit; font-size: 11px; line-height: 1.5; text-align: left;
    color: var(--fg); background: transparent;
    border: 0; border-radius: 0.375rem; cursor: pointer;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .menu-item:hover { background: var(--hover-bg); }
  .menu-item:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }

  /* Highlight frames: one per matching image, drawn over its box in the same
     rAF pass that places the badges, and painted beneath them so a chip still
     sits on its image's corner. pointer-events stay off so the page's own
     clicks on the image go through. The current match (the one the page last
     scrolled to) wears a second ring outside a card-colored gap. */
  .frames { position: absolute; inset: 0; pointer-events: none; }
  .frame {
    position: absolute; top: 0; left: 0; box-sizing: border-box;
    border: 2px solid var(--loss); border-radius: 3px;
    will-change: transform; pointer-events: none;
  }
  .frame.current { box-shadow: 0 0 0 2px var(--card), 0 0 0 4px var(--loss); }
  .root[data-tone='accent'] .frame { border-color: var(--accent); }
  .root[data-tone='accent'] .frame.current { box-shadow: 0 0 0 2px var(--card), 0 0 0 4px var(--accent); }
  /* The highlight bar: what is framed, which match the page is on, and the
     way out. Its three buttons are 24x24 targets (WCAG 2.5.8). */
  .hbar {
    display: inline-flex; align-items: center;
    padding: 0 2px 0 10px; color: var(--fg); background: var(--card);
    border: 1px solid var(--border); border-radius: 9999px;
    font-size: 11px; line-height: 1; white-space: nowrap; pointer-events: auto;
  }
  .hbar[hidden] { display: none; }
  .hdot { width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: var(--loss); flex: 0 0 auto; }
  .root[data-tone='accent'] .hdot { background: var(--accent); }
  .hcount { margin: 0 6px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .hbtn {
    appearance: none; width: 24px; height: 24px; margin: 0; padding: 0;
    font: inherit; font-size: 14px; line-height: 1; color: var(--muted);
    background: transparent; border: 0; border-radius: 9999px; cursor: pointer;
  }
  .hbtn:hover:not(:disabled) { color: var(--fg); background: var(--hover-bg); }
  .hbtn:disabled { opacity: 0.4; cursor: default; }
  .hbtn:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
`;

function makeText(tag: string, cls: string, text: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  el.textContent = text;
  return el;
}

export function createOverlay(
  onOptimize: (src: string, opener: HTMLElement) => void,
  onSwitchAction: (action: SwitchActionId) => void
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
  // Resolved once to a const so the closures below (setMuted) see a non-null root.
  const root: HTMLElement =
    shadow.querySelector<HTMLElement>('.root') ??
    (() => {
      const created = document.createElement('div');
      created.className = 'root';
      shadow.append(created);
      return created;
    })();

  // Badges live in their own container so the Badge switch (its sibling
  // inside the styled root) survives hiding them.
  const existingBadges = root.querySelector<HTMLElement>('.badges');
  const container = existingBadges ?? document.createElement('div');
  if (!existingBadges) {
    container.className = 'badges';
    root.append(container);
  }

  // Frames sit beneath the badges so a chip still reads on its image's corner.
  const frames = document.createElement('div');
  frames.className = 'frames';
  root.insertBefore(frames, container);

  // img → its badge wrap. A Map keeps the per-frame reposition and the
  // IntersectionObserver callback O(visible) instead of scanning every badge.
  const byImg = new Map<HTMLImageElement, HTMLElement>();
  // img → its findings, so a highlight can be re-applied after any re-collect.
  const findingsByImg = new Map<HTMLImageElement, ImageFindings>();
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

  // The active highlight: its key, the matching <img> elements in document
  // order, the one the page last scrolled to, and the frame drawn over each.
  let highlightKey: HighlightKey | null = null;
  let hits: HTMLImageElement[] = [];
  let hitIndex = 0;
  const frameByImg = new Map<HTMLImageElement, HTMLElement>();

  /** The optimize panel shares this shadow root and owns Escape while open. */
  function optimizeOpen(): boolean {
    return shadow.querySelector<HTMLElement>('.obk')?.style.display === 'flex';
  }

  function onDocPointerDown(event: PointerEvent): void {
    if (pinnedWrap && !event.composedPath().includes(pinnedWrap)) unpinCurrent?.();
  }
  function onDocKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    // One Escape, one target: a pinned panel or the menu first, then the
    // highlight. Never the highlight while the optimize modal is up, since the
    // modal was likely opened from a framed image and takes the same key.
    if (pinnedWrap) unpinCurrent?.();
    else if (highlightKey !== null && !optimizeOpen()) setHighlight(null);
  }
  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener('keydown', onDocKeydown, true);

  // The on-page switcher: a pill that opens a menu. The click itself changes
  // nothing -- it offers the two scopes (this host, every site) and waits.
  const switchWrap = document.createElement('div');
  switchWrap.className = 'switch-wrap';
  switchWrap.style.display = 'none'; // shown once the page has badged images

  const switchLabel = document.createElement('span');
  switchLabel.className = 'switch-label';

  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▾';
  caret.setAttribute('aria-hidden', 'true');

  const switchButton = document.createElement('button');
  switchButton.type = 'button';
  switchButton.className = 'switch';
  // A disclosure, not an ARIA menu. The fix is the *absence* of role="menu" and
  // role="menuitem" below: those put screen readers into application mode where
  // arrow keys are the expected navigation and there are none, and .menu-head is
  // not a permitted child of role="menu", so its link could go unexposed. The
  // value here is not what does that work -- ARIA maps aria-haspopup="true" onto
  // "menu", so the two are equivalent and swapping them changes nothing. Plain
  // buttons plus aria-expanded give the Tab/Enter/Escape model actually built.
  switchButton.setAttribute('aria-haspopup', 'true');
  switchButton.setAttribute('aria-expanded', 'false');
  switchButton.append(switchLabel, caret);

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.hidden = true;

  const menuHead = document.createElement('div');
  menuHead.className = 'menu-head';
  const menuTitle = document.createElement('span');
  menuTitle.textContent = 'aura x-ray';
  const menuHelp = document.createElement('a');
  menuHelp.className = 'menu-help';
  menuHelp.href = 'https://auraimage.ai/extension';
  menuHelp.target = '_blank';
  menuHelp.rel = 'noreferrer';
  menuHelp.textContent = 'help';
  menuHelp.setAttribute('aria-label', 'what is aura x-ray?');
  menuHead.append(menuTitle, menuHelp);
  menu.append(menuHead);

  switchWrap.append(switchButton, menu);

  // The highlight bar, stacked above the switcher in the dock.
  function barButton(glyph: string, name: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hbtn';
    button.textContent = glyph;
    button.setAttribute('aria-label', name);
    button.title = name;
    return button;
  }
  const bar = document.createElement('div');
  bar.className = 'hbar';
  bar.hidden = true;
  bar.setAttribute('role', 'group');
  const barDot = document.createElement('span');
  barDot.className = 'hdot';
  barDot.setAttribute('aria-hidden', 'true');
  const barLabel = makeText('span', 'hlabel', '');
  const barCount = makeText('span', 'hcount', '');
  barCount.setAttribute('aria-live', 'polite');
  const barPrev = barButton('‹', 'previous match');
  const barNext = barButton('›', 'next match');
  const barClear = barButton('×', 'clear highlight');
  bar.append(barDot, barLabel, barCount, barPrev, barNext, barClear);
  barPrev.addEventListener('click', () => goTo(stepIndex(hitIndex, -1, hits.length)));
  barNext.addEventListener('click', () => goTo(stepIndex(hitIndex, 1, hits.length)));
  barClear.addEventListener('click', () => {
    // The bar disappears with the highlight; keyboard focus lands on the
    // switcher instead of vanishing (a no-op while the switcher is hidden).
    const hadFocus = bar.contains(shadow.activeElement);
    setHighlight(null);
    if (hadFocus) switchButton.focus();
  });

  const dock = document.createElement('div');
  dock.className = 'dock';
  dock.append(bar, switchWrap);
  root.append(dock);

  function closeMenu(): void {
    if (menu.hidden) return;
    const hadFocusInside = menu.contains(shadow.activeElement);
    menu.hidden = true;
    switchButton.setAttribute('aria-expanded', 'false');
    if (pinnedWrap === switchWrap) {
      pinnedWrap = null;
      unpinCurrent = null;
    }
    if (hadFocusInside) switchButton.focus();
  }

  function openMenu(): void {
    // The switcher is a page-level control, so it takes the single pinned slot
    // from any open badge panel. One Escape then always has exactly one target.
    if (pinnedWrap && pinnedWrap !== switchWrap) unpinCurrent?.();
    menu.hidden = false;
    switchButton.setAttribute('aria-expanded', 'true');
    pinnedWrap = switchWrap;
    unpinCurrent = closeMenu;
  }

  switchButton.addEventListener('click', () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  function runAction(id: SwitchActionId): void {
    closeMenu();
    // Apply locally for instant feedback; the callback persists, and
    // storage.onChanged echoes the same state into every other tab.
    if (id === 'hide-host') setMuted(true);
    else setBadgesEnabled(id === 'show-all');
    onSwitchAction(id);
  }

  function syncSwitch(): void {
    const model = buildSwitchModel({
      badgeCount: byImg.size,
      badgesEnabled: badgesOn,
      muted: mutedNow,
      hostname: location.hostname
    });
    switchWrap.style.display = model.visible ? '' : 'none';
    if (!model.visible) closeMenu();
    switchButton.classList.toggle('off', model.collapsed);
    switchButton.setAttribute('aria-label', model.ariaLabel);
    switchButton.title = 'aura x-ray options';
    switchLabel.textContent = model.label;

    // Rebuild the rows ONLY when they actually change. syncSwitch() runs on
    // every recollect, and the MutationObserver's is trailing-debounced: one
    // lands shortly after each burst of DOM churn settles, so an SPA navigation
    // or an ad rotation triggers one. An unconditional rebuild would destroy a
    // focused row and swallow an in-flight click every time. The id list fully
    // determines the rows: labels depend only on the hostname, which is
    // constant for the page.
    const signature = model.items.map((item) => item.id).join(',');
    if (menu.dataset.items !== signature) {
      // The rows are about to change under the cursor -- which also happens
      // when another tab flips the Badge switch and reorders them. Close first,
      // so a click aimed at one row cannot land on another.
      if (!menu.hidden) closeMenu();
      menu.dataset.items = signature;
      // forEach, not for...of: it does not depend on the DOM.Iterable lib.
      menu.querySelectorAll('.menu-item').forEach((stale) => stale.remove());
      for (const item of model.items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu-item';
        button.textContent = item.label;
        button.title = item.label; // the full host, when the label truncates
        button.addEventListener('click', () => runAction(item.id));
        menu.append(button);
      }
    }
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
    // Frames follow their images regardless of the badge switch: a highlight
    // is an explicit request, not ambient. Size writes only when changed.
    for (const [img, frame] of frameByImg) {
      if (!visible.has(img)) {
        frame.style.display = 'none';
        continue;
      }
      const rect = img.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        frame.style.display = 'none';
        continue;
      }
      frame.style.display = '';
      frame.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
      const width = `${Math.round(rect.width)}px`;
      const height = `${Math.round(rect.height)}px`;
      if (frame.style.width !== width) frame.style.width = width;
      if (frame.style.height !== height) frame.style.height = height;
    }
    rafId = requestAnimationFrame(positionAll);
  }

  function clearFrames(): void {
    for (const frame of frameByImg.values()) frame.remove();
    frameByImg.clear();
    hits = [];
  }

  /** Rebuild the frames and the badge hit/dim states for the active key. */
  function applyHighlight(): void {
    clearFrames();
    const key = highlightKey;
    if (key === null) delete root.dataset.tone;
    else root.dataset.tone = highlightTone(key);
    container.classList.toggle('filtering', key !== null);
    for (const [img, wrap] of byImg) {
      const findings = findingsByImg.get(img);
      const hit = key !== null && findings !== undefined && matchesHighlight(key, findings);
      wrap.classList.toggle('hit', hit);
      if (!hit) continue;
      hits.push(img);
      const frame = document.createElement('div');
      frame.className = 'frame';
      frame.style.display = 'none';
      frames.append(frame);
      frameByImg.set(img, frame);
    }
    // Document order, so ‹ › walk the page top to bottom even when a reused
    // resource's second element was collected ahead of its DOM neighbors.
    hits.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    hitIndex = hits.length === 0 ? 0 : Math.min(hitIndex, hits.length - 1);
    markCurrent();
    syncBar();
  }

  function markCurrent(): void {
    const current = hits[hitIndex];
    for (const [img, frame] of frameByImg) frame.classList.toggle('current', img === current);
  }

  /** Make match `index` current and bring it into view. */
  function goTo(index: number): void {
    hitIndex = index;
    markCurrent();
    syncBar();
    const target = hits[index];
    if (!target) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }

  function syncBar(): void {
    if (highlightKey === null) {
      bar.hidden = true;
      return;
    }
    const model = buildHighlightBarModel(highlightKey, hitIndex, hits.length);
    barLabel.textContent = model.label;
    barCount.textContent = model.counter;
    bar.setAttribute('aria-label', model.ariaLabel);
    barPrev.disabled = !model.canStep;
    barNext.disabled = !model.canStep;
    bar.hidden = false;
  }

  function setHighlight(key: HighlightKey | null): number {
    const changed = key !== highlightKey;
    highlightKey = key;
    if (changed) hitIndex = 0;
    applyHighlight();
    // A new key starts at its first match; re-asserting the same key (or a
    // re-collect) leaves the page where it is.
    if (changed && key !== null) goTo(0);
    return hits.length;
  }

  function clear(): void {
    io.disconnect();
    visible.clear();
    // A pin held by a badge wrap is stale, since the loop below destroys them.
    // The switcher's wrap hangs off .root and survives, so an open menu keeps
    // the slot: dropping it would leave the menu visibly open while Escape and
    // outside-click both stop reaching it, on the first recollect after any
    // burst of DOM churn settles. Do not "simplify" this back to an
    // unconditional reset.
    if (pinnedWrap !== switchWrap) {
      pinnedWrap = null;
      unpinCurrent = null;
    }
    for (const wrap of byImg.values()) wrap.remove();
    byImg.clear();
    findingsByImg.clear();
    clearFrames();
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

  function buildPanel(findings: ImageFindings, chip: HTMLButtonElement): HTMLElement {
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
    button.addEventListener('click', () => onOptimize(findings.facts.currentSrc, chip));
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
    if (findings.facts.isLcp) chip.append(makeText('span', 'clcp', 'lcp'));

    const slot = document.createElement('div');
    slot.className = 'slot';
    const panel = buildPanel(findings, chip);
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
        findingsByImg.set(img, item.findings);
        io.observe(img);
      }
    }
    if (rafId === 0) rafId = requestAnimationFrame(positionAll);
    syncSwitch();
    // Re-frame the active highlight against the fresh analysis; the bar's
    // count follows, and the current match stays put.
    applyHighlight();
  }

  function setMuted(muted: boolean): void {
    mutedNow = muted;
    // A class on .root, not display on the root or the host: the optimize panel
    // is a sibling of .root and must still open on a muted host (from the
    // popup's `fix first` list or the context menu), and a highlight asked for
    // from the popup still frames its images here (see .root.muted in STYLE).
    root.classList.toggle('muted', muted);
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
    setHighlight,
    getHighlight: () => highlightKey,
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

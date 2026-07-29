import { type BrowserContext, chromium, expect, test } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const extensionPath = join(repoRoot, '.output', 'chrome-mv3');

let context: BrowserContext;
let server: Server;
let baseUrl: string;

// Fixture page: one oversized image (the 128px icon shown at 32px) and one with
// no alt attribute, served over http (not file://) so the <all_urls> content
// script actually runs against it.
async function startFixtureServer(): Promise<{ server: Server; url: string }> {
  const iconBytes = await readFile(join(repoRoot, 'public', 'icons', '128.png'));
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>AuraImage e2e fixture</title></head>',
    '<body>',
    '<img id="oversized" src="/icon.png" alt="logo" width="32" height="32">',
    '<img id="no-alt" src="/icon.png" width="128" height="128">',
    '</body>',
    '</html>'
  ].join('');

  const srv = createServer((req, res) => {
    if (req.url === '/icon.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(iconBytes);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address === null || typeof address === 'string') throw new Error('no listen address');
      resolve({ server: srv, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

test.beforeAll(async () => {
  const fixture = await startFixtureServer();
  server = fixture.server;
  baseUrl = fixture.url;

  const userDataDir = await mkdtemp(join(tmpdir(), 'aura-xray-e2e-'));
  // The `chromium` channel enables the new headless mode, the only way to load
  // an MV3 extension headless in CI. Relax the sandbox only under CI (root).
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      ...(process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [])
    ]
  });
});

test.afterAll(async () => {
  await context?.close();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('MV3 service worker registers from the built manifest', async () => {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  expect(worker.url()).toMatch(/background\.js$/);
});

test('content script injects its overlay host on a real page', async () => {
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'load' });

  // <aura-xray-root> is created synchronously at content-script load and lives in
  // the light DOM; its open shadow root confirms the overlay actually attached.
  await page.locator('aura-xray-root').waitFor({ timeout: 30_000 });
  const hasShadowRoot = await page.evaluate(() => Boolean(document.querySelector('aura-xray-root')?.shadowRoot));
  expect(hasShadowRoot).toBe(true);
});

/**
 * Hit-tests the switcher's real clickable extent on a grid, in viewport
 * coordinates. Deliberately NOT getBoundingClientRect: the target is carried by
 * a ::before halo that extends past the button's own box, so only a hit test
 * sees it. Runs inside the page because it needs the open shadow root.
 *
 * Grid sampling yields a LOWER bound -- the span between the outermost hits
 * understates the true extent by up to 2 * STEP -- so callers must compare
 * against the requirement minus that slack, never against the raw number.
 */
const MEASURE_STEP = 0.25;

async function measureSwitchHitBox(page: import('@playwright/test').Page): Promise<{
  width: number;
  height: number;
  overhangRight: number;
  overhangBottom: number;
  expanded: boolean;
  hovered: boolean;
}> {
  return page.evaluate((step: number) => {
    const shadow = document.querySelector('aura-xray-root')?.shadowRoot;
    if (!shadow) throw new Error('no overlay shadow root');
    const button = shadow.querySelector<HTMLElement>('.switch');
    const label = shadow.querySelector<HTMLElement>('.switch-label');
    if (!button || !label) throw new Error('no switcher in the overlay');

    const box = button.getBoundingClientRect();
    const pad = 14; // the halo reaches 6px past the border box; 14 clears it
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let x = box.left - pad; x <= box.right + pad; x += step) {
      for (let y = box.top - pad; y <= box.bottom + pad; y += step) {
        if (shadow.elementFromPoint(x, y) !== button) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (minX === Infinity) throw new Error('the switcher hit-tested nowhere');

    return {
      width: maxX - minX,
      height: maxY - minY,
      // How far the clickable region reaches PAST the button's own box, on the
      // two edges nearest the viewport corner. This, not the total size, is what
      // a fixed-size halo silently loses when the button grows: the total box
      // grows with the button while the overhang collapses to nothing.
      overhangRight: maxX - box.right,
      overhangBottom: maxY - box.bottom,
      // The expansion is CSS-only, so a visible label is the honest signal that
      // the rule engaged rather than an assumption that hovering worked.
      expanded: getComputedStyle(label).display !== 'none',
      hovered: button.matches(':hover')
    };
  }, MEASURE_STEP);
}

/**
 * Guards the collapsed dot's 24x24 hit target (WCAG 2.2 AA, SC 2.5.8). It is the
 * only route back from a global hide, and three assumptions hold it up that no
 * other gate can see:
 *
 *  1. The ::before halo overflows .switch-wrap unclipped. An `overflow: hidden`
 *     on .switch-wrap, .root, or the host silently reverts the target to 12x12.
 *  2. `inset: -7px` encodes "10px padding box + 14", coupled to `width: 12px`
 *     with nothing linking them. Change the width, or set an explicit
 *     box-sizing, and the target drops under 24x24 with both numbers still
 *     looking individually correct.
 *  3. `right/bottom: 12px` must stay above 7px, or the halo clips on the
 *     viewport edges -- losing target size exactly where the pointer arrives.
 *
 * The overhang assertions exist because a fixed-size halo once re-centred as the
 * button grew, leaving a dead band along the edges nearest the viewport corner:
 * live while collapsed, dead once expanded, which oscillates under a pointer.
 * They are deliberately NOT assertions about the total hit box, which is the
 * trap here -- the total grows with the button even as the overhang dies, so a
 * "does not shrink" check on width and height passes against that exact bug.
 * Verified by reintroducing it: only the overhang assertions catch it.
 *
 * Neither lint, type-check, build, nor vitest can catch any of this. vitest in
 * particular never imports overlay.ts at all -- it passed 225 green while that
 * file was syntactically broken -- so this is the only automated protection the
 * geometry has.
 */
test('the collapsed dot keeps a 24x24 hit target, and keeps its overhang when it expands', async () => {
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.locator('aura-xray-root').waitFor({ timeout: 30_000 });

  // Drive the global Badge switch off from the service worker rather than
  // through the menu: this test is about geometry, and ADR 0028 keeps this spec
  // off the extension's interaction surface. The content script picks it up via
  // storage.onChanged.
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    // `chrome` is ambient in an MV3 service worker but has no type declaration
    // here: this spec sits outside tsconfig's include and the repo ships no
    // extension type package. Typed locally so it survives someone adding
    // tests/ to tsconfig later.
    const { chrome } = globalThis as unknown as {
      chrome: { storage: { sync: { set: (items: Record<string, unknown>) => Promise<void> } } };
    };
    await chrome.storage.sync.set({ badgesEnabled: false });
  });

  // Wait for the collapsed state to actually engage, rather than assuming the
  // storage write landed.
  await page.waitForFunction(
    () => {
      const shadow = document.querySelector('aura-xray-root')?.shadowRoot;
      const button = shadow?.querySelector<HTMLElement>('.switch');
      const wrap = shadow?.querySelector<HTMLElement>('.switch-wrap');
      return Boolean(button?.matches('.switch.off') && wrap && wrap.style.display !== 'none');
    },
    undefined,
    { timeout: 30_000 }
  );

  const collapsed = await measureSwitchHitBox(page);
  expect(collapsed.expanded).toBe(false);

  // 24 minus the sampling slack: the measured span is a lower bound on the true
  // extent. Still far above the 12x12 and 22x22 regressions this guards.
  const minimum = 24 - 2 * MEASURE_STEP;
  expect(collapsed.width, `collapsed hit width ${collapsed.width}px`).toBeGreaterThanOrEqual(minimum);
  expect(collapsed.height, `collapsed hit height ${collapsed.height}px`).toBeGreaterThanOrEqual(minimum);

  // Expand it by hovering, which is how a pointer user meets the dead band.
  const box = await page.evaluate(() => {
    const button = document.querySelector('aura-xray-root')?.shadowRoot?.querySelector<HTMLElement>('.switch');
    if (!button) throw new Error('no switcher to hover');
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.waitForFunction(() => {
    const label = document.querySelector('aura-xray-root')?.shadowRoot?.querySelector<HTMLElement>('.switch-label');
    return Boolean(label && getComputedStyle(label).display !== 'none');
  });

  const expanded = await measureSwitchHitBox(page);
  expect(expanded.expanded).toBe(true);
  expect(expanded.hovered).toBe(true);

  // The real guarantee: the halo still reaches past the button on the two edges
  // nearest the viewport corner. True overhang is 6px (7px inset less the 1px
  // border); 4 leaves room for sampling slack while sitting far above the ~0-1px
  // a re-centring halo collapses to.
  const minOverhang = 4;
  expect(expanded.overhangRight, `expanded right overhang ${expanded.overhangRight}px`).toBeGreaterThanOrEqual(
    minOverhang
  );
  expect(expanded.overhangBottom, `expanded bottom overhang ${expanded.overhangBottom}px`).toBeGreaterThanOrEqual(
    minOverhang
  );
  expect(collapsed.overhangRight, `collapsed right overhang ${collapsed.overhangRight}px`).toBeGreaterThanOrEqual(
    minOverhang
  );
});

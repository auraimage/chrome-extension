// Capture Chrome Web Store screenshots (1280x800) from the BUILT extension.
// Run with `pnpm screenshots`; answers are collected interactively via
// @clack/prompts (in a non-interactive shell it falls back to the defaults:
// the bundled demo gallery, hero framing). Requires Node 24+ (native
// TypeScript type stripping) and a prior `pnpm build`.
//
// Produces in store-assets/:
//   01-badges-<slug>.png   the page with ambient badges over every image
//   02-findings-<slug>.png the same page with the popup Findings card
//                          composited top-right, the way it opens in Chrome
//   popup-<slug>.png       the raw popup capture, for reference
//
// The popup normally reads chrome.tabs.query({active:true}) — opened as a raw
// extension page it would audit itself. We patch chrome.tabs.query at
// document_start to return the target tab, so the card renders the page's real
// findings (hostname, byte totals, flags), not staged data.
//
// The bundled demo page (demo/) is served locally and DNS-mapped inside Chrome
// so the Findings card shows a clean hostname instead of 127.0.0.1. Its images
// are gitignored; regenerate them once with `pnpm demo:images`.
import * as p from '@clack/prompts';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Page } from 'puppeteer';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const dist = join(repoRoot, 'dist');
const demoDir = join(repoRoot, 'demo');
const outDir = join(repoRoot, 'store-assets');

const STORE_W = 1280;
const STORE_H = 800;
const SCALE = 2; // capture at 2x, downscale once at the end for crisp text

const DEMO_HOST = 'demo.auraimage.ai';

interface ShotPlan {
  url: string;
  slug: string;
  scrollTo: number;
  serveDir: string | null;
  fakeHost: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
};

/** Serve `dir` statically on an ephemeral loopback port. */
function startFixtureServer(dir: string): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    void (async () => {
      const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
      const file = join(dir, path === '/' ? 'index.html' : path);
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    })();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('no listen address');
      resolve({ server, port: address.port });
    });
  });
}

/** Wait until the overlay shadow root holds at least `min` badge chips. */
async function waitForBadges(page: Page, min: number, timeout: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      (want: number) => {
        const root = document.querySelector('aura-xray-root');
        return Boolean(root?.shadowRoot && root.shadowRoot.querySelectorAll('.chip').length >= want);
      },
      { timeout },
      min
    );
    return true;
  } catch {
    return false;
  }
}

/** Rounded corners + a soft drop shadow so the composited popup reads as Chrome's popup window. */
async function popupWithShadow(popupPng: Uint8Array): Promise<Buffer> {
  const meta = await sharp(popupPng).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const radius = 12 * SCALE;
  const pad = 20 * SCALE;

  const roundedMask = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}"/></svg>`
  );
  const rounded = await sharp(popupPng)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const shadow = Buffer.from(
    `<svg width="${w + pad * 2}" height="${h + pad * 2}">
      <defs><filter id="f" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="${8 * SCALE}"/>
      </filter></defs>
      <rect x="${pad}" y="${pad + 4 * SCALE}" width="${w}" height="${h}" rx="${radius}"
        fill="rgba(0,0,0,0.5)" filter="url(#f)"/>
    </svg>`
  );
  return sharp({
    create: { width: w + pad * 2, height: h + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: rounded, left: pad, top: pad }
    ])
    .png()
    .toBuffer();
}

async function capture(plan: ShotPlan): Promise<void> {
  await mkdir(outDir, { recursive: true });

  let fixture: { server: Server; port: number } | null = null;
  let url = plan.url;
  if (plan.serveDir) {
    fixture = await startFixtureServer(plan.serveDir);
    url = `http://${plan.fakeHost}:${fixture.port}/`;
    p.log.info(`serving ${plan.serveDir} as ${url}`);
  }

  const launchOptions: Parameters<typeof puppeteer.launch>[0] = { enableExtensions: [dist] };
  if (fixture) launchOptions.args = [`--host-resolver-rules=MAP ${plan.fakeHost} 127.0.0.1`];
  const browser = await puppeteer.launch(launchOptions);
  try {
    const worker = await browser.waitForTarget(
      (target) => target.type() === 'service_worker' && target.url().endsWith('background.js'),
      { timeout: 30_000 }
    );
    const extensionId = new URL(worker.url()).host;

    // --- Shot 1: the page with ambient badges -------------------------------
    const page = await browser.newPage();
    await page.setViewport({ width: STORE_W, height: STORE_H, deviceScaleFactor: SCALE });
    // Image-dense pages overflow the default 250-entry Resource Timing buffer,
    // after which badges lose their transfer-size byte counts.
    await page.evaluateOnNewDocument(() => performance.setResourceTimingBufferSize(10_000));
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await sleep(3_000);
    // Nudge lazy-loaded images into view, then settle on the requested framing.
    await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 2 }));
    await sleep(1_500);
    await page.evaluate((top: number) => window.scrollTo({ top }), plan.scrollTo);
    await sleep(1_500);
    // Natively lazy-loaded images don't mutate the DOM, so the content script
    // never re-collects and their badges stay format-only. Nudge its
    // MutationObserver so the badges pick up the now-known transfer sizes.
    await page.evaluate(() => document.body.appendChild(document.createComment('aura-recollect')));
    await sleep(1_500);
    const badged = await waitForBadges(page, 3, 20_000);
    if (!badged) p.log.warn('fewer than 3 badges appeared; capturing anyway');

    const pageShot = await page.screenshot({ type: 'png' });
    await sharp(pageShot).resize(STORE_W, STORE_H).png().toFile(join(outDir, `01-badges-${plan.slug}.png`));
    p.log.success(`wrote store-assets/01-badges-${plan.slug}.png`);

    // --- Shot 2: popup Findings card over the same page ---------------------
    const popup = await browser.newPage();
    await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await popup.evaluateOnNewDocument((targetUrl: string) => {
      const real = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (async (info: chrome.tabs.QueryInfo) => {
        const tabs = await real({});
        const hits = tabs.filter((tab) => tab.url === targetUrl);
        return hits.length ? hits : real(info);
      }) as typeof chrome.tabs.query;
    }, page.url());
    await popup.setViewport({ width: 320, height: 400, deviceScaleFactor: SCALE });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
    try {
      await popup.waitForFunction(() => document.querySelector('.stats dd')?.textContent, { timeout: 15_000 });
    } catch {
      p.log.warn('popup rendered the restricted fallback, not the Findings card');
    }
    await sleep(500);
    const popupShot = await popup.screenshot({ type: 'png', fullPage: true });
    await sharp(popupShot).toFile(join(outDir, `popup-${plan.slug}.png`));
    p.log.success(`wrote store-assets/popup-${plan.slug}.png`);

    // Composite top-right, roughly where Chrome anchors the action popup.
    const popupLayer = await popupWithShadow(popupShot);
    const layerMeta = await sharp(popupLayer).metadata();
    const margin = 12 * SCALE;
    // Two sharp calls: sharp always resizes before compositing within one
    // pipeline, which would shrink the canvas below the popup layer's size.
    const composed = await sharp(pageShot)
      .composite([
        {
          input: popupLayer,
          left: STORE_W * SCALE - (layerMeta.width ?? 0) - margin,
          top: margin
        }
      ])
      .png()
      .toBuffer();
    await sharp(composed).resize(STORE_W, STORE_H).png().toFile(join(outDir, `02-findings-${plan.slug}.png`));
    p.log.success(`wrote store-assets/02-findings-${plan.slug}.png`);
  } finally {
    await browser.close().catch(() => {});
    if (fixture) fixture.server.close();
  }
}

function bail(value: unknown): asserts value is string {
  if (p.isCancel(value)) {
    p.cancel('cancelled');
    process.exit(1);
  }
}

async function planFromPrompts(): Promise<ShotPlan> {
  p.intro('aura x-ray — store screenshots');

  if (!process.stdin.isTTY) {
    p.log.info('non-interactive shell: using defaults (demo gallery, hero framing)');
    return { url: '', slug: 'demo-hero', scrollTo: 0, serveDir: demoDir, fakeHost: DEMO_HOST };
  }

  const target = await p.select({
    message: 'What should the extension audit?',
    options: [
      { value: 'demo', label: 'Bundled demo gallery (demo/)', hint: 'clean, art-directed backdrop' },
      { value: 'url', label: 'A live URL', hint: 'any public page' }
    ]
  });
  bail(target);

  if (target === 'demo') {
    const scroll = await p.text({
      message: 'Scroll offset in CSS px (0 = masthead + hero)',
      initialValue: '0',
      validate: (value) => (/^\d+$/.test(value) ? undefined : 'enter a non-negative integer')
    });
    bail(scroll);
    const slug = await p.text({
      message: 'Slug for the output filenames',
      initialValue: Number(scroll) === 0 ? 'demo-hero' : `demo-${scroll}`
    });
    bail(slug);
    return { url: '', slug, scrollTo: Number(scroll), serveDir: demoDir, fakeHost: DEMO_HOST };
  }

  const url = await p.text({
    message: 'Page URL',
    placeholder: 'https://example.com/',
    validate: (value) => (/^https?:\/\//.test(value) ? undefined : 'enter an http(s) URL')
  });
  bail(url);
  const scroll = await p.text({
    message: 'Scroll offset in CSS px before the badges shot',
    initialValue: '0',
    validate: (value) => (/^\d+$/.test(value) ? undefined : 'enter a non-negative integer')
  });
  bail(scroll);
  const slug = await p.text({
    message: 'Slug for the output filenames',
    initialValue: new URL(url).hostname.replace(/^www\./, '').replace(/\W+/g, '-')
  });
  bail(slug);
  return { url, slug, scrollTo: Number(scroll), serveDir: null, fakeHost: DEMO_HOST };
}

async function main(): Promise<void> {
  if (!existsSync(join(dist, 'manifest.json'))) {
    p.log.error('dist/manifest.json not found — run "pnpm build" first');
    process.exit(1);
  }

  const plan = await planFromPrompts();

  if (plan.serveDir && !existsSync(join(demoDir, 'images', 'plate-001-first-light.jpg'))) {
    p.log.error('demo/images/ is empty — run "pnpm demo:images" once to generate it');
    process.exit(1);
  }

  await capture(plan);
  p.outro('done');
}

main().catch((error: unknown) => {
  p.log.error(`screenshots failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

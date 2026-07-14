// Capture the remaining Chrome Web Store screenshots (1280x800) from the
// BUILT extension: the shots of the store-listing.md shot-list that
// screenshots.mts (badges + findings on a chosen page) does not cover.
// Requires Node 24+ and a prior `pnpm build`. Run with `pnpm store-shots`,
// optionally passing one group: `pnpm store-shots optimize|wedge`.
//
// Produces in store-assets/:
//   03-optimize-unsplash.png  the optimize panel over a real Unsplash JPEG,
//                             with genuine stats and smart-crops from the
//                             production edge (no mocks, no staged bytes)
//   04-smartcrop-unsplash.png zoomed detail of the smart-crop strip
//                             (640x400 CSS clip at 2x = native store size)
//   05-wedge-cloudinary.png   the popup Findings card composited over a page
//                             served by Cloudinary, "served via" line visible
import * as p from '@clack/prompts';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const dist = join(repoRoot, 'dist');
const outDir = join(repoRoot, 'store-assets');

const STORE_W = 1280;
const STORE_H = 800;
const SCALE = 2; // capture at 2x, downscale once at the end for crisp text

// Shot 3/4 target: a big public JPEG the production edge can measure.
const OPTIMIZE_IMAGE_URL = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?q=90&w=4000&fm=jpg';
// Shot 5 target: a page whose images a known competitor CDN serves.
const WEDGE_URL = 'https://cloudinary.com/';
const WEDGE_SLUG = 'cloudinary';
const WEDGE_SCROLL = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** Fire the same message the context menu sends so the content script opens the panel. */
async function openOptimizePanel(browser: Browser, src: string): Promise<void> {
  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().endsWith('background.js'),
    { timeout: 30_000 }
  );
  const worker = await workerTarget.worker();
  if (!worker) throw new Error('no service worker handle');
  const outcome = await worker.evaluate(
    (target: string) =>
      new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tabId = tabs[0]?.id;
          if (tabId === undefined) return resolve('no tab');
          chrome.tabs.sendMessage(tabId, { type: 'aura:open-optimize', src: target }, () =>
            resolve(chrome.runtime.lastError?.message ?? 'ok')
          );
        });
      }),
    src
  );
  // "message port closed" is the normal fire-and-forget outcome: the content
  // script handles aura:open-optimize without calling sendResponse.
  if (outcome !== 'ok' && !String(outcome).includes('message port closed')) {
    throw new Error(`open failed: ${String(outcome)}`);
  }
}

// --- Shots 3 + 4: the optimize panel with real production numbers ----------
async function captureOptimize(): Promise<void> {
  const browser = await puppeteer.launch({ enableExtensions: [dist] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: STORE_W, height: STORE_H, deviceScaleFactor: SCALE });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.goto(OPTIMIZE_IMAGE_URL, { waitUntil: 'load', timeout: 90_000 });
    await sleep(2_500); // ambient pass + badge

    await openOptimizePanel(browser, OPTIMIZE_IMAGE_URL);

    // Real edge transforms take a while; wait for the bars, then for all three
    // smart-crop thumbnails (no skeleton tiles left).
    await page.waitForFunction(
      () => !!document.querySelector('aura-xray-root')?.shadowRoot?.querySelector('.obars'),
      { timeout: 120_000, polling: 500 }
    );
    p.log.info('optimize stats rendered');
    await page.waitForFunction(
      () => {
        const shadow = document.querySelector('aura-xray-root')?.shadowRoot;
        return !!shadow && shadow.querySelectorAll('.ocrops canvas').length >= 3;
      },
      { timeout: 180_000, polling: 500 }
    );
    p.log.info('smart crops rendered');
    await sleep(1_200); // bar animation + decode settle

    const shot = await page.screenshot({ type: 'png' });
    await sharp(shot).resize(STORE_W, STORE_H).png().toFile(join(outDir, '03-optimize-unsplash.png'));
    p.log.success('wrote store-assets/03-optimize-unsplash.png');

    // Shot 4: 640x400 CSS clip at deviceScaleFactor 2 -> exactly 1280x800 px.
    // Frame the lower half of the card with no element sliced at the frame
    // boundary. Preferred: bottom-align to the card's bottom edge so the
    // frame reaches up to (but not into) the savings headline. If the bars
    // block doesn't fit under the headline, anchor to the blurhash row.
    const clip = await page.evaluate(() => {
      const shadow = document.querySelector('aura-xray-root')?.shadowRoot;
      const card = shadow?.querySelector('.ocard');
      const headline = shadow?.querySelector('.oheadline');
      const bars = shadow?.querySelector('.obars');
      const hashrow = shadow?.querySelector('.ohashrow');
      const crops = shadow?.querySelector('.ocrops');
      if (!card || !crops) throw new Error('no card/crops');
      const cardRect = card.getBoundingClientRect();
      const w = 640;
      const h = 400;
      const bottomAligned = cardRect.bottom + 10 - h;
      const headlineFloor = (headline?.getBoundingClientRect().bottom ?? 0) + 4;
      const barsTop = (bars ?? crops).getBoundingClientRect().top;
      let y: number;
      if (bottomAligned >= headlineFloor && bottomAligned <= barsTop - 6) {
        y = bottomAligned;
      } else {
        y = (hashrow ?? crops).getBoundingClientRect().top - 12;
      }
      const cx = cardRect.x + cardRect.width / 2;
      const x = Math.min(Math.max(0, cx - w / 2), window.innerWidth - w);
      y = Math.min(Math.max(0, y), window.innerHeight - h);
      return { x, y, width: w, height: h };
    });
    const detail = await page.screenshot({ type: 'png', clip });
    await sharp(detail).png().toFile(join(outDir, '04-smartcrop-unsplash.png'));
    p.log.success('wrote store-assets/04-smartcrop-unsplash.png');
  } finally {
    await browser.close().catch(() => {});
  }
}

// --- Shot 5: the "served via <Vendor>" wedge line ---------------------------
async function captureWedge(): Promise<void> {
  const browser = await puppeteer.launch({ enableExtensions: [dist] });
  try {
    const workerTarget = await browser.waitForTarget(
      (target) => target.type() === 'service_worker' && target.url().endsWith('background.js'),
      { timeout: 30_000 }
    );
    const extensionId = new URL(workerTarget.url()).host;

    const page = await browser.newPage();
    await page.setViewport({ width: STORE_W, height: STORE_H, deviceScaleFactor: SCALE });
    // Image-dense pages overflow the default 250-entry Resource Timing buffer,
    // after which badges lose their transfer-size byte counts.
    await page.evaluateOnNewDocument(() => performance.setResourceTimingBufferSize(10_000));
    await page.goto(WEDGE_URL, { waitUntil: 'load', timeout: 90_000 });
    await sleep(3_000);
    // Nudge lazy-loaded images into view, then settle on the requested framing.
    await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 2 }));
    await sleep(1_500);
    await page.evaluate((top: number) => window.scrollTo({ top }), WEDGE_SCROLL);
    await sleep(1_500);
    await page.evaluate(() => document.body.appendChild(document.createComment('aura-recollect')));
    await sleep(1_500);
    const badged = await waitForBadges(page, 3, 20_000);
    if (!badged) p.log.warn('fewer than 3 badges appeared; capturing anyway');
    const pageShot = await page.screenshot({ type: 'png' });

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
    await popup.waitForFunction(() => document.querySelector('.stats dd')?.textContent, { timeout: 15_000 });
    // The whole point of this shot: fail loudly when the wedge line is absent.
    try {
      await popup.waitForFunction(() => !!document.querySelector('.cdn'), { timeout: 10_000 });
    } catch {
      throw new Error(`no "served via" line rendered; is ${WEDGE_URL} still served by a known image CDN?`);
    }
    await sleep(500);
    const popupShot = await popup.screenshot({ type: 'png', fullPage: true });

    // Composite top-right, roughly where Chrome anchors the action popup.
    const popupLayer = await popupWithShadow(popupShot);
    const layerMeta = await sharp(popupLayer).metadata();
    const margin = 12 * SCALE;
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
    await sharp(composed).resize(STORE_W, STORE_H).png().toFile(join(outDir, `05-wedge-${WEDGE_SLUG}.png`));
    p.log.success(`wrote store-assets/05-wedge-${WEDGE_SLUG}.png`);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  p.intro('aura x-ray — store shots 03-05');
  const which = process.argv[2] ?? 'all';
  if (!['all', 'optimize', 'wedge'].includes(which)) {
    p.log.error(`unknown group "${which}" — pass optimize, wedge, or nothing for all`);
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });
  if (which === 'all' || which === 'optimize') await captureOptimize();
  if (which === 'all' || which === 'wedge') await captureWedge();
  p.outro('done');
}

main().catch((error: unknown) => {
  p.log.error(`store shots failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

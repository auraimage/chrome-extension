// Generate the two Chrome Web Store promo tiles from an HTML template:
//
//   promo-small-440x280.png    brand card: caret-tile lockup, tagline, and a
//                              faint row of the extension's real badge chips
//   promo-marquee-1400x560.png brand block left, the committed Findings-card
//                              popup capture (popup-demo-hero.png) right
//
// Both are 24-bit PNG with NO alpha channel (a store requirement for promo
// tiles; the script asserts it). Rendered in headless Chrome at 2x and
// downscaled once for crisp text; Geist comes from the local `geist` package
// as data URIs, so no network is touched. Run with `pnpm store-tiles`.
// Requires Node 24+ and a prior `pnpm install`.
import * as p from '@clack/prompts';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const outDir = join(repoRoot, 'store-assets');
const fontsDir = join(repoRoot, 'node_modules', 'geist', 'dist', 'fonts');

const SCALE = 2;

async function fontFace(family: string, weight: number, file: string): Promise<string> {
  const woff2 = await readFile(join(fontsDir, file));
  return `@font-face {
    font-family: '${family}';
    font-weight: ${weight};
    src: url(data:font/woff2;base64,${woff2.toString('base64')}) format('woff2');
  }`;
}

/** Shared styles: dark hue-260 surface, brand lockup, and the overlay's real chip styling. */
function baseCss(fonts: string, width: number, height: number): string {
  return `${fonts}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px; height: ${height}px; overflow: hidden;
    background: oklch(0.14 0.005 260); color: oklch(0.95 0.003 260);
    font-family: 'Geist', sans-serif;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  .lockup { display: flex; align-items: center; }
  .brand { font-weight: 700; letter-spacing: -0.02em; }
  .suffix { font-family: 'Geist Mono', monospace; font-weight: 400; color: oklch(0.65 0.005 260); }
  .tagline { font-family: 'Geist Mono', monospace; color: oklch(0.65 0.005 260); }
  .chips { display: flex; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 6px; font-family: 'Geist Mono', monospace; font-size: 11px; line-height: 1;
    color: oklch(0.95 0.003 260); background: oklch(0.17 0.005 260);
    border: 1px solid oklch(0.28 0.005 260); border-radius: 0.375rem; white-space: nowrap;
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: oklch(0.95 0.003 260); flex: 0 0 auto; }`;
}

/** The caret-tile mark, light-on-dark colorway (white tile, dark caret) as on every dark brand surface. */
function mark(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7.5" fill="#fafafa"/>
    <path d="M12.06 9.28 L20.7 16 L12.06 22.72" stroke="#17191e" stroke-width="3.8"
      stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`;
}

/** Real badge-chip strings (format token + transfer size), one flagged with the warning dot. */
function chips(): string {
  return `<div class="chips">
    <span class="chip"><span class="dot"></span>jpeg 4.2 MB</span>
    <span class="chip">avif 180 KB</span>
    <span class="chip">webp 210 KB</span>
  </div>`;
}

function smallTileHtml(fonts: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${baseCss(fonts, 440, 280)}
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .lockup { gap: 12px; }
  .brand { font-size: 30px; }
  .suffix { font-size: 22px; margin-left: 2px; }
  .tagline { font-size: 14px; margin-top: 14px; }
  .chips { position: absolute; bottom: 22px; left: 0; right: 0; justify-content: center; gap: 10px; opacity: 0.6; }
  </style></head><body>
    <div class="lockup">${mark(34)}<span class="brand">auraimage</span><span class="suffix">x-ray</span></div>
    <div class="tagline">measured, not scored</div>
    ${chips()}
  </body></html>`;
}

function marqueeHtml(fonts: string, popupDataUri: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${baseCss(fonts, 1400, 560)}
  body { display: flex; align-items: center; justify-content: space-between; padding: 0 96px; }
  .left { display: flex; flex-direction: column; }
  .lockup { gap: 18px; }
  .brand { font-size: 46px; }
  .suffix { font-size: 33px; margin-left: 3px; }
  .tagline { font-size: 20px; margin-top: 22px; }
  .chips { gap: 12px; margin-top: 34px; opacity: 0.6; }
  .popup {
    height: 470px; border-radius: 14px;
    border: 1px solid oklch(0.28 0.005 260);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }
  </style></head><body>
    <div class="left">
      <div class="lockup">${mark(52)}<span class="brand">auraimage</span><span class="suffix">x-ray</span></div>
      <div class="tagline">measured, not scored</div>
      ${chips()}
    </div>
    <img class="popup" src="${popupDataUri}">
  </body></html>`;
}

/** Render `html` at 2x, downscale, strip alpha, and assert the store's exact spec. */
async function renderTile(html: string, width: number, height: number, file: string): Promise<void> {
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: SCALE });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    const shot = await page.screenshot({ type: 'png' });
    const out = join(outDir, file);
    await sharp(shot).resize(width, height).removeAlpha().png().toFile(out);

    const meta = await sharp(out).metadata();
    if (meta.width !== width || meta.height !== height || meta.channels !== 3 || meta.hasAlpha) {
      throw new Error(
        `${file} violates the store spec: ${meta.width}x${meta.height}, ${meta.channels} channels, alpha=${String(meta.hasAlpha)}`
      );
    }
    p.log.success(`wrote store-assets/${file}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  p.intro('aura x-ray — store promo tiles');
  await mkdir(outDir, { recursive: true });

  const fonts = (
    await Promise.all([
      fontFace('Geist', 400, 'geist-sans/Geist-Regular.woff2'),
      fontFace('Geist', 700, 'geist-sans/Geist-Bold.woff2'),
      fontFace('Geist Mono', 400, 'geist-mono/GeistMono-Regular.woff2')
    ])
  ).join('\n');
  const popup = await readFile(join(outDir, 'popup-demo-hero.png'));
  const popupDataUri = `data:image/png;base64,${popup.toString('base64')}`;

  await renderTile(smallTileHtml(fonts), 440, 280, 'promo-small-440x280.png');
  await renderTile(marqueeHtml(fonts, popupDataUri), 1400, 560, 'promo-marquee-1400x560.png');
  p.outro('done');
}

main().catch((error: unknown) => {
  p.log.error(`store tiles failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

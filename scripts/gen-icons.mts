import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// The AuraImage caret-tile brand mark: a dark rounded tile with the
// terminal-prompt caret drawn in explicit light ink. The brand SVGs knock the
// caret out of the tile, but a toolbar icon sits on an unknown background, so
// here the caret is painted rather than transparent. Geometry mirrors
// logo-black.svg (17-unit tile: rx 3.99, stroke 2.01, caret 6.41,4.93 ->
// 11.00,8.50 -> 6.41,12.07). The 128 doubles as the Web Store icon upload, so
// its artwork is 96x96 centered in a 16px transparent margin per store
// guidelines; 16/48 stay full-bleed for toolbar legibility. Run once via
// `pnpm gen-icons`; the PNGs are committed so the build never depends on
// sharp. Requires Node 24+ (native TypeScript type stripping).
const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, '..', 'public', 'icons');

const BG = '#17191e';
const FG = '#fafafa';
const TILE_UNITS = 17;
const SIZES: { size: number; pad: number }[] = [
  { size: 16, pad: 0 },
  { size: 48, pad: 0 },
  { size: 128, pad: 16 }
];

function svg(size: number, pad: number): string {
  const tile = size - pad * 2;
  const u = (n: number) => +(pad + (tile * n) / TILE_UNITS).toFixed(3);
  const radius = +((tile * 3.99) / TILE_UNITS).toFixed(3);
  const stroke = +((tile * 2.01) / TILE_UNITS).toFixed(3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${pad}" y="${pad}" width="${tile}" height="${tile}" rx="${radius}" fill="${BG}"/>
  <path d="M ${u(6.41)} ${u(4.93)} L ${u(11)} ${u(8.5)} L ${u(6.41)} ${u(12.07)}"
    fill="none" stroke="${FG}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

await mkdir(outDir, { recursive: true });
for (const { size, pad } of SIZES) {
  const png = await sharp(Buffer.from(svg(size, pad)))
    .png()
    .toBuffer();
  await writeFile(join(outDir, `${size}.png`), png);
}
console.log(`icons written to ${outDir}`);

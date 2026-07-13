import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Monochrome placeholder icon: a dark hue-260 square with a lighter "X" glyph
// (the "X-Ray" mark). Run once via `pnpm gen-icons`; the PNGs are committed so
// the build never depends on sharp.
const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, '..', 'public', 'icons');

const BG = '#08090b'; // oklch(0.14 0.005 260) equivalent
const FG = '#ededf0'; // oklch(0.95 0.003 260) equivalent
const SIZES = [16, 48, 128];

function svg(size) {
  const inset = Math.round(size * 0.3);
  const stroke = Math.max(1, Math.round(size * 0.09));
  const radius = Math.round(size * 0.22);
  const far = size - inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>
  <g stroke="${FG}" stroke-width="${stroke}" stroke-linecap="round">
    <line x1="${inset}" y1="${inset}" x2="${far}" y2="${far}"/>
    <line x1="${far}" y1="${inset}" x2="${inset}" y2="${far}"/>
  </g>
</svg>`;
}

await mkdir(outDir, { recursive: true });
for (const size of SIZES) {
  const png = await sharp(Buffer.from(svg(size))).png().toBuffer();
  await writeFile(join(outDir, `${size}.png`), png);
}
console.log(`icons written to ${outDir}`);

// Regenerate demo/images/ for the committed demo gallery (demo/index.html).
// Downloads each plate from picsum.photos (photo IDs are stable) and transcodes
// it into a deliberately heavy asset so the extension has real waste to
// measure: q95 JPEGs at print resolution, one fat PNG, and one well-optimized
// WebP as the good citizen. Run with `pnpm demo:images`; the outputs are
// gitignored. Requires Node 24+ (native TypeScript type stripping).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

interface Plate {
  /** picsum.photos photo id — fixed, always returns the same photograph. */
  id: number;
  /** Output basename; must match the <img> src in demo/index.html. */
  name: string;
  fmt: 'jpeg' | 'png' | 'webp';
  width: number;
  quality?: number;
}

const PLATES: Plate[] = [
  { id: 1018, name: 'plate-001-first-light', fmt: 'jpeg', width: 4200, quality: 95 },
  { id: 1015, name: 'plate-002-river-bend', fmt: 'jpeg', width: 3600, quality: 95 },
  { id: 1016, name: 'plate-003-canyon-wall', fmt: 'jpeg', width: 3600, quality: 92 },
  { id: 1022, name: 'plate-004-night-sky', fmt: 'jpeg', width: 3200, quality: 92 },
  { id: 1021, name: 'plate-005-fog-pines', fmt: 'png', width: 2600 },
  { id: 1036, name: 'plate-006-high-ridge', fmt: 'jpeg', width: 3600, quality: 95 },
  { id: 1039, name: 'plate-007-falls-mist', fmt: 'jpeg', width: 3400, quality: 92 },
  { id: 1019, name: 'plate-008-storm-dusk', fmt: 'jpeg', width: 4000, quality: 95 },
  { id: 1044, name: 'plate-009-river-crossing', fmt: 'jpeg', width: 3600, quality: 95 },
  { id: 1043, name: 'plate-010-valley-wall', fmt: 'jpeg', width: 3200, quality: 92 },
  { id: 1041, name: 'plate-011-wave-study', fmt: 'jpeg', width: 3000, quality: 90 },
  { id: 1049, name: 'plate-012-sea-stack', fmt: 'jpeg', width: 3000, quality: 92 },
  { id: 1053, name: 'plate-013-surf-above', fmt: 'webp', width: 1600, quality: 80 },
  { id: 1050, name: 'plate-014-sea-arches', fmt: 'jpeg', width: 3200, quality: 92 }
];

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'demo', 'images');

await mkdir(outDir, { recursive: true });

for (const plate of PLATES) {
  const res = await fetch(`https://picsum.photos/id/${plate.id}/1600/1067.jpg`);
  if (!res.ok) throw new Error(`picsum id ${plate.id} (${plate.name}): HTTP ${res.status}`);
  const input = Buffer.from(await res.arrayBuffer());

  let pipeline = sharp(input).resize({ width: plate.width, kernel: 'lanczos3' });
  if (plate.fmt === 'jpeg') pipeline = pipeline.jpeg({ quality: plate.quality, chromaSubsampling: '4:4:4' });
  if (plate.fmt === 'png') pipeline = pipeline.png();
  if (plate.fmt === 'webp') pipeline = pipeline.webp({ quality: plate.quality });

  const ext = plate.fmt === 'jpeg' ? 'jpg' : plate.fmt;
  const buffer = await pipeline.toBuffer();
  await writeFile(join(outDir, `${plate.name}.${ext}`), buffer);
  console.log(`${plate.name}.${ext}  ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
}

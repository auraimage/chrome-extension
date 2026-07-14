import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

// Content script must be a classic script (iife); the MV3 service worker is an
// ESM module ("type": "module" in manifest.json); popup and options are bundled
// for their respective extension pages.
interface Bundle {
  entry: string;
  out: string;
  format: 'iife' | 'esm';
}

const bundles: Bundle[] = [
  { entry: 'src/content/index.ts', out: 'content.js', format: 'iife' },
  { entry: 'src/background/index.ts', out: 'background.js', format: 'esm' },
  { entry: 'src/popup/popup.ts', out: 'popup.js', format: 'iife' },
  { entry: 'src/options/options.ts', out: 'options.js', format: 'iife' }
];

const buildOptions: esbuild.BuildOptions[] = bundles.map(({ entry, out, format }) => ({
  entryPoints: [join(root, entry)],
  outfile: join(dist, out),
  bundle: true,
  format,
  platform: 'browser',
  target: 'chrome120',
  logLevel: 'info'
}));

async function copyStatic(): Promise<void> {
  await cp(join(root, 'manifest.json'), join(dist, 'manifest.json'));
  await cp(join(root, 'src/popup/popup.html'), join(dist, 'popup.html'));
  await cp(join(root, 'src/options/options.html'), join(dist, 'options.html'));
  await cp(join(root, 'public/icons'), join(dist, 'icons'), { recursive: true });
}

async function main(): Promise<void> {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  if (watch) {
    const contexts = await Promise.all(buildOptions.map((options) => esbuild.context(options)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    await copyStatic();
    console.log('esbuild watching for changes...');
  } else {
    await Promise.all(buildOptions.map((options) => esbuild.build(options)));
    await copyStatic();
    console.log('build complete: dist/');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

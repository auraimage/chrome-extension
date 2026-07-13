import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { verifyDist } from './verify-dist.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const dist = join(repoRoot, 'dist');

const { ok, errors, manifest } = verifyDist(dist);
if (!ok) {
  console.error('pack aborted: dist/ did not pass verification:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

// Chrome Web Store requires manifest.json at the archive root, so zip the
// contents of dist/ (cwd = dist, path ".") rather than the dist/ directory
// itself. Use the system zip binary to avoid an npm dependency just for packing.
const zipName = `auraimage-x-ray-v${manifest.version}.zip`;
const zipPath = join(repoRoot, zipName);

rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', '-X', zipPath, '.'], { cwd: dist, stdio: 'inherit' });

console.log(`packed ${zipName}`);

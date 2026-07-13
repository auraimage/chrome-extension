import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectManifestRefs } from './manifest-refs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultDist = join(here, '..', 'dist');

// Validate a built dist/ against its own manifest.json. Returns collected errors
// instead of throwing so pack.mjs can gate on the result and the CLI can report
// every problem at once. The returned manifest lets callers reuse the version.
export function verifyDist(distDir = defaultDist) {
  const manifestPath = join(distDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return { ok: false, errors: ['manifest.json not found in dist/ (run the build first)'], manifest: null };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return { ok: false, errors: ['manifest.json in dist/ is not valid JSON'], manifest: null };
  }

  const errors = [];

  if (manifest.manifest_version !== 3) {
    errors.push(`manifest_version must be 3, found ${JSON.stringify(manifest.manifest_version)}`);
  }

  for (const ref of collectManifestRefs(manifest)) {
    if (!existsSync(join(distDir, ref))) {
      errors.push(`manifest references "${ref}" but dist/${ref} is missing`);
    }
  }

  return { ok: errors.length === 0, errors, manifest };
}

function main() {
  const { ok, errors } = verifyDist();
  if (!ok) {
    console.error('verify-dist failed:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log('verify-dist passed: dist/ matches manifest.json');
}

// Run main() only when invoked directly, not when imported by pack.mjs or a test.
// realpathSync + pathToFileURL normalizes argv[1] so the comparison holds whether
// the script was launched by a relative or absolute path.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main();
}

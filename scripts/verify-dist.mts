import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type ManifestRefsSource, collectManifestRefs } from './manifest-refs.mts';

const here = dirname(fileURLToPath(import.meta.url));
const defaultDist = join(here, '..', 'dist');

/** A built manifest.json: the referenced files plus the fields verification reads. */
export interface DistManifest extends ManifestRefsSource {
  manifest_version?: number;
  version: string;
}

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  manifest: DistManifest | null;
}

// Validate a built dist/ against its own manifest.json. Returns collected errors
// instead of throwing so pack.mts can gate on the result and the CLI can report
// every problem at once. The returned manifest lets callers reuse the version.
export function verifyDist(distDir: string = defaultDist): VerifyResult {
  const manifestPath = join(distDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return { ok: false, errors: ['manifest.json not found in dist/ (run the build first)'], manifest: null };
  }

  let manifest: DistManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DistManifest;
  } catch {
    return { ok: false, errors: ['manifest.json in dist/ is not valid JSON'], manifest: null };
  }

  const errors: string[] = [];

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

function main(): void {
  const { ok, errors } = verifyDist();
  if (!ok) {
    console.error('verify-dist failed:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log('verify-dist passed: dist/ matches manifest.json');
}

// Run main() only when invoked directly, not when imported by pack.mts or a test.
// realpathSync + pathToFileURL normalizes argv[1] so the comparison holds whether
// the script was launched by a relative or absolute path.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main();
}

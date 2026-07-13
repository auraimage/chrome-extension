import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectManifestRefs } from './manifest-refs.mjs';
import { verifyDist } from './verify-dist.mjs';

const fullManifest = {
  manifest_version: 3,
  version: '1.2.3',
  background: { service_worker: 'background.js', type: 'module' },
  content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
  action: { default_popup: 'popup.html' },
  options_page: 'options.html',
  icons: { 16: 'icons/16.png', 48: 'icons/48.png', 128: 'icons/128.png' }
};

describe('collectManifestRefs', () => {
  it('collects every referenced file across all manifest sections', () => {
    expect(collectManifestRefs(fullManifest)).toEqual([
      'background.js',
      'content.js',
      'popup.html',
      'options.html',
      'icons/16.png',
      'icons/48.png',
      'icons/128.png'
    ]);
  });

  it('walks multiple content scripts and multiple js entries', () => {
    const manifest = {
      content_scripts: [{ js: ['a.js', 'b.js'] }, { js: ['c.js'] }]
    };
    expect(collectManifestRefs(manifest)).toEqual(['a.js', 'b.js', 'c.js']);
  });

  it('returns an empty list when the manifest references nothing', () => {
    expect(collectManifestRefs({ manifest_version: 3 })).toEqual([]);
  });
});

describe('verifyDist', () => {
  let distDir;

  function writeManifest(manifest) {
    writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(manifest));
  }

  function touchRefs(manifest) {
    for (const ref of collectManifestRefs(manifest)) {
      const target = join(distDir, ref);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, '');
    }
  }

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), 'verify-dist-'));
  });

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true });
  });

  it('passes when the manifest is valid and every referenced file exists', () => {
    writeManifest(fullManifest);
    touchRefs(fullManifest);

    const result = verifyDist(distDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.manifest.version).toBe('1.2.3');
  });

  it('fails when a referenced file is missing from dist/', () => {
    writeManifest(fullManifest);
    touchRefs(fullManifest);
    rmSync(join(distDir, 'content.js'));

    const result = verifyDist(distDir);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('manifest references "content.js" but dist/content.js is missing');
  });

  it('fails when manifest_version is not 3', () => {
    writeManifest({ ...fullManifest, manifest_version: 2 });
    touchRefs(fullManifest);

    const result = verifyDist(distDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('manifest_version'))).toBe(true);
  });

  it('fails when manifest.json is absent', () => {
    const result = verifyDist(distDir);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('manifest.json not found');
  });

  it('fails when manifest.json is not valid JSON', () => {
    writeFileSync(join(distDir, 'manifest.json'), '{ not json');

    const result = verifyDist(distDir);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('not valid JSON');
  });
});

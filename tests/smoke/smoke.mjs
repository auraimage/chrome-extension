// Puppeteer smoke test for the BUILT Chrome MV3 extension. The 186 vitest tests
// run in jsdom and cannot see a real Chrome, so they can never catch "the
// extension fails to load": a broken manifest, a service worker that never
// registers, or a content script that crashes at document_idle. This is the one
// automated net for that class. It is a plain Node script (not vitest) so it is
// not swept up by "pnpm test"; run it with "pnpm test:smoke" after "pnpm build".
//
// It makes exactly two assertions against the loaded extension:
//   1. the MV3 service worker (background.js) registered, and
//   2. the content script ran on a real page and injected its overlay host.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const dist = join(repoRoot, 'dist');

// Umbrella deadline for the whole run so a hung launch, missing service worker,
// or content script that never injects can never wedge CI. Per-step waits are
// shorter so a failing step reports before the umbrella fires.
const HARD_TIMEOUT_MS = 60_000;
const STEP_TIMEOUT_MS = 30_000;

// The smoke test loads dist/, never src/, so a build is a hard precondition.
function requireBuild() {
  if (!existsSync(dist) || !existsSync(join(dist, 'manifest.json'))) {
    console.error('smoke test failed: dist/manifest.json not found. Run "pnpm build" first.');
    process.exit(1);
  }
}

// Local fixture page: one image rendered far below its natural size (the 128px
// icon shown at 32px, the oversized-download signal the ambient analyzer looks
// for) and one image with no alt attribute. Served over http, not file://, so
// the <all_urls> content script actually runs against it.
function startFixtureServer() {
  const iconBytes = readFileSync(join(repoRoot, 'public/icons/128.png'));
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>AuraImage smoke fixture</title></head>',
    '<body>',
    '<img id="oversized" src="/icon.png" alt="logo" width="32" height="32">',
    '<img id="no-alt" src="/icon.png" width="128" height="128">',
    '</body>',
    '</html>'
  ].join('');

  const server = createServer((req, res) => {
    if (req.url === '/icon.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(iconBytes);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

// enableExtensions loads the built extension and works in the default headless
// mode. Under CI the runner is often root, where Chrome refuses its sandbox, so
// relax it there only; locally the sandbox stays on.
function launchOptions() {
  const options = { enableExtensions: [dist] };
  if (process.env.CI) options.args = ['--no-sandbox', '--disable-setuid-sandbox'];
  return options;
}

async function main() {
  const { server, url } = await startFixtureServer();
  let browser;
  let timer;
  try {
    const work = (async () => {
      browser = await puppeteer.launch(launchOptions());

      // Assertion 1: the MV3 service worker registered from the built manifest.
      const worker = await browser.waitForTarget(
        (target) => target.type() === 'service_worker' && target.url().endsWith('background.js'),
        { timeout: STEP_TIMEOUT_MS }
      );

      // Assertion 2: the content script ran and injected its overlay host.
      // <aura-xray-root> is created synchronously at content-script load and
      // lives in the light DOM, so a plain selector finds it; its open shadow
      // root confirms the overlay actually attached.
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('aura-xray-root', { timeout: STEP_TIMEOUT_MS });
      const hasShadowRoot = await page.evaluate(() => Boolean(document.querySelector('aura-xray-root')?.shadowRoot));
      if (!hasShadowRoot) throw new Error('<aura-xray-root> is present but has no shadow root');

      return worker.url();
    })();

    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`hard timeout after ${HARD_TIMEOUT_MS / 1000}s`)), HARD_TIMEOUT_MS);
    });

    const workerUrl = await Promise.race([work, timeout]);

    console.log('PASS: AuraImage extension smoke test');
    console.log(`  [1/2] MV3 service worker registered: ${workerUrl}`);
    console.log('  [2/2] content script injected <aura-xray-root> shadow host on the fixture page');
  } finally {
    clearTimeout(timer);
    if (browser) await browser.close().catch(() => {});
    await closeServer(server);
  }
}

// A malformed extension (bad manifest, a manifest file that does not exist) is
// the primary break this test exists to catch, yet puppeteer.launch() still
// resolves for it: the Extensions.loadUnpacked failure surfaces later as an
// unhandled rejection that no try/catch around launch can see. Turn any such
// stray rejection into the same clean failure + nonzero exit as everything else.
process.on('unhandledRejection', (reason) => {
  console.error(`smoke test failed: ${reason instanceof Error ? reason.message : String(reason)}`);
  process.exit(1);
});

requireBuild();
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`smoke test failed: ${error.message}`);
    process.exit(1);
  });

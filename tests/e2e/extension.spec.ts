import { type BrowserContext, chromium, expect, test } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const extensionPath = join(repoRoot, '.output', 'chrome-mv3');

let context: BrowserContext;
let server: Server;
let baseUrl: string;

// Fixture page: one oversized image (the 128px icon shown at 32px) and one with
// no alt attribute, served over http (not file://) so the <all_urls> content
// script actually runs against it.
async function startFixtureServer(): Promise<{ server: Server; url: string }> {
  const iconBytes = await readFile(join(repoRoot, 'public', 'icons', '128.png'));
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>AuraImage e2e fixture</title></head>',
    '<body>',
    '<img id="oversized" src="/icon.png" alt="logo" width="32" height="32">',
    '<img id="no-alt" src="/icon.png" width="128" height="128">',
    '</body>',
    '</html>'
  ].join('');

  const srv = createServer((req, res) => {
    if (req.url === '/icon.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(iconBytes);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address === null || typeof address === 'string') throw new Error('no listen address');
      resolve({ server: srv, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

test.beforeAll(async () => {
  const fixture = await startFixtureServer();
  server = fixture.server;
  baseUrl = fixture.url;

  const userDataDir = await mkdtemp(join(tmpdir(), 'aura-xray-e2e-'));
  // The `chromium` channel enables the new headless mode, the only way to load
  // an MV3 extension headless in CI. Relax the sandbox only under CI (root).
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      ...(process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [])
    ]
  });
});

test.afterAll(async () => {
  await context?.close();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('MV3 service worker registers from the built manifest', async () => {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  expect(worker.url()).toMatch(/background\.js$/);
});

test('content script injects its overlay host on a real page', async () => {
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'load' });

  // <aura-xray-root> is created synchronously at content-script load and lives in
  // the light DOM; its open shadow root confirms the overlay actually attached.
  await page.locator('aura-xray-root').waitFor({ timeout: 30_000 });
  const hasShadowRoot = await page.evaluate(() => Boolean(document.querySelector('aura-xray-root')?.shadowRoot));
  expect(hasShadowRoot).toBe(true);
});

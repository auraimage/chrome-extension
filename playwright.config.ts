import { defineConfig } from '@playwright/test';

// E2E for the BUILT Chrome MV3 extension. The 214 vitest tests run in a fake
// browser and cannot see a real Chrome, so they can never catch "the extension
// fails to load": a broken manifest, a service worker that never registers, or
// a content script that crashes. This is the one automated net for that class.
// The spec loads .output/chrome-mv3 with launchPersistentContext, so a build is
// a precondition (`wxt build` before `pnpm test:e2e`). Extensions load headless
// only via the `chromium` channel, so no xvfb is needed in CI.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list'
});

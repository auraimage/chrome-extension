import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// WxtVitest polyfills the extension API with an in-memory fake-browser, applies
// WXT's Vite config (so `@/` aliases and `import.meta.env` resolve), and aliases
// `wxt/browser` to the fake browser. Tests that touch storage/messaging use
// `fakeBrowser` from 'wxt/testing/fake-browser' and reset it in beforeEach.
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node'
  }
});

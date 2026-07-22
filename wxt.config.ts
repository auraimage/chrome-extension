import { defineConfig } from 'wxt';

// AuraImage X-Ray, built with WXT (ADR 0028). Source lives under src/; the four
// entrypoints (background, content, popup, options) are file-based under
// src/entrypoints. Auto-imports are off — every helper and the `browser` global
// is imported explicitly, matching the rest of the codebase. The version is
// sourced from package.json (the single version source of truth), so it is
// deliberately omitted here.
export default defineConfig({
  srcDir: 'src',
  imports: false,
  manifest: {
    name: 'Image Optimizer & Audit: AVIF, WebP, Alt Text | AuraImage X-Ray',
    description:
      'Image optimizer and audit: AVIF/WebP on click, alt text, Core Web Vitals. Zero auth, open source, measured, not scored.',
    permissions: ['contextMenus', 'storage', 'clipboardWrite'],
    host_permissions: ['<all_urls>'],
    icons: {
      16: 'icons/16.png',
      48: 'icons/48.png',
      128: 'icons/128.png'
    }
  }
});

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
  // On-brand zip name (e.g. auraimage-x-ray-0.0.3-chrome.zip) rather than the
  // mangled scoped package name; the release workflow globs *-chrome.zip.
  zip: {
    name: 'auraimage-x-ray',
    // The Firefox sources zip (AMO rebuilds from source) needs only build
    // inputs. demo/ (a demo page + multi-MB sample images) and store-assets/
    // (listing screenshots) are dev/marketing assets, not build inputs; WXT
    // already drops dotfiles, node_modules, and tests. (ADR 0029)
    excludeSources: ['demo/**', 'store-assets/**']
  },
  // Function form so the Firefox build can carry its add-on identity. WXT
  // targets MV2 for Firefox (ADR 0029) and auto-converts this MV3 block:
  // host_permissions folds into permissions (granted at install, so badges
  // still auto-appear), action -> browser_action, service worker -> event page.
  manifest: ({ browser }) => ({
    name: 'Image Optimizer & Audit: AVIF, WebP, Alt Text | AuraImage X-Ray',
    description:
      'Image optimizer and audit: AVIF/WebP on click, alt text, Core Web Vitals. Zero auth, open source, measured, not scored.',
    permissions: ['contextMenus', 'storage', 'clipboardWrite'],
    host_permissions: ['<all_urls>'],
    icons: {
      16: 'icons/16.png',
      48: 'icons/48.png',
      128: 'icons/128.png'
    },
    // AMO bakes this id into the listing on first publish, so it is permanent.
    // Firefox-only; Chrome/Edge manifests never carry browser_specific_settings.
    ...(browser === 'firefox' && {
      browser_specific_settings: { gecko: { id: 'x-ray@auraimage.ai' } }
    })
  })
});

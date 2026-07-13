# AuraImage X-Ray

[![CI](https://github.com/auraimage/chrome-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/auraimage/chrome-extension/actions/workflows/ci.yml)

A zero-auth Chrome extension that audits and optimizes the images on any page:
real AVIF/WebP on click, alt text, and page-speed findings. Measured, not
scored.

**Landing page:** https://auraimage.ai/extension

**Chrome Web Store:** coming soon

AuraImage X-Ray is a zero-auth image auditor for the browser. It runs on any
website, for anyone, with no account. It badges every image on the current page
with its format and transfer size, flags the wasteful ones (oversized for their
display box, missing `alt`, no `srcset`), and rolls the page up into a shareable
Findings card of real, falsifiable measurements. Click an image to run the live
edge demo: a genuine before/after (AVIF and WebP re-encode, smart-crop,
blurhash) fetched from the AuraImage CDN. There is no synthesized composite
number. The findings are measured, not scored. The full rationale, including why
this is the product's first unauthenticated public route, is in
[ADR 0024](../../docs/adr/0024-browser-extension-zero-auth-image-auditor.md).

## Install (unpacked)

```bash
pnpm --filter @auraimage/extension build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select `apps/extension/dist`.

Chrome shows the "read and change all your data on all websites" warning. That
is the cost of ambient badges on every page; see the open-source note below.

## Development

```bash
pnpm --filter @auraimage/extension build       # one-shot build into dist/
pnpm --filter @auraimage/extension dev         # esbuild --watch, rebuild on change
pnpm --filter @auraimage/extension test        # vitest, pure modules
pnpm --filter @auraimage/extension type-check  # tsc --noEmit
pnpm --filter @auraimage/extension lint        # eslint
```

`build.mjs` compiles four bundles with esbuild (`content.js` as an IIFE,
`background.js` as an ESM service-worker module, `popup.js` and `options.js` for
their pages) and copies `manifest.json`, the two HTML pages, and `public/icons`
into `dist/`. After a rebuild, reload the extension in `chrome://extensions`:
watch mode recompiles the bundles but Chrome does not hot-reload a running
service worker.

The test suite covers the pure modules only (analysis, findings model, markdown,
card layout, snippet, competitors, format, gate, edge client, URL parser,
context-menu routing). The browser-only paths (`OffscreenCanvas`,
`createImageBitmap`, `PerformanceObserver`) are not runnable under Node and are
covered by the manual checklist below.

## Releasing

The version lives in exactly one place: `version` in `manifest.json`. There is
no separate source of truth (the `package.json` version is unused). To cut a
release, bump that field, commit, and push a matching tag:

```bash
# edit manifest.json: "version": "0.1.0"
git commit -am "release: v0.1.0"
git tag v0.1.0
git push --tags
```

The `v*` tag triggers `.github/workflows/release.yml`, which:

1. Fails fast unless the tag equals `v{manifest.json version}`, so a mistyped
   tag or a forgotten manifest bump stops the run before anything ships.
2. Runs the full CI gauntlet (lint, type-check, test, build, verify-dist, pack,
   smoke).
3. Creates a GitHub Release named after the tag with generated notes and the
   packed `auraimage-x-ray-v*.zip` attached.
4. Uploads and publishes that zip to the Chrome Web Store, but only when the
   store secrets are configured. Without them the store steps are skipped and
   the run logs a notice; the GitHub Release is still created either way.

Chrome Web Store publishing needs five repository secrets:

- `CWS_PUBLISHER_ID`: the publisher ID from the Chrome Web Store developer
  dashboard.
- `CWS_EXTENSION_ID`: the item ID of the listing (the id in its store URL).
- `CWS_CLIENT_ID` and `CWS_CLIENT_SECRET`: a Google Cloud OAuth 2.0 client
  (Desktop app type) with the Chrome Web Store API enabled.
- `CWS_REFRESH_TOKEN`: a refresh token minted once for that client against the
  `https://www.googleapis.com/auth/chromewebstore` scope.

If the store upload fails after the GitHub Release is already created (an
expired refresh token, a Google-side outage), do not retag. Re-run the release
from the Actions tab: pick the `release` workflow, choose **Run workflow**, and
select the existing `vX.Y.Z` tag as the ref. The run detects the existing
GitHub Release and re-attaches the zip with `--clobber` instead of failing, then
retries the store upload and publish. A `workflow_dispatch` run pointed at a
branch instead of a tag fails fast with a clear message.

## Architecture

Two surfaces, one rule: the ambient work is free and never leaves the browser;
every edge call is click-triggered and metered.

- **Ambient pass** (always-on, 100% client-side). The content script collects
  DOM facts for each image (format, natural vs displayed dimensions, `alt`,
  `loading`, `srcset`, bytes from the Resource Timing API), analyzes them
  locally, badges the page through a shadow-DOM overlay, and feeds the popup's
  Findings card. It never touches the network. It is unlimited, free, and works
  offline.
- **Demo transform** (click-triggered edge). Clicking an image's `optimize`
  action sends one thing to the demo endpoint: the image URL. The endpoint is
  anonymous, stateless, and rate-limited; it runs the real serve pipeline
  (AVIF/WebP encode, smart-crop, blurhash) and persists nothing. This is what
  produces the real before/after proof, so the extension is a live demo of the
  AuraImage edge rather than a mock.
- **Export gate**. Seeing the audit is always free. Keeping the optimized output
  is not: `download avif`, `download webp`, `copy <picture> snippet`, and the
  offline WebP save each spend one of three free exports, after which the export
  control becomes a "create a free project" link. The cost circuit-breaker and
  the conversion wall are deliberately the same wall.
- **Offline compress**. Right-click an image and pick `Download as WebP
  (offline)` to decode and re-encode entirely on-device via `OffscreenCanvas`,
  no network. AVIF wasm was the design target; WebP shipped because it is
  verifiable in the service worker without a wasm bundle or a CSP change. The
  codec is a swappable seam (`OFFLINE_EXT` and `OFFLINE_MENU_TITLE` in
  `src/shared/context-menu.ts`, plus `encodeOffline`'s body); see ADR 0024 and
  the note in `src/background/offline-encode.ts`.

Code map:

```
src/content      ambient overlay, badges, optimize panel, offline-download UI
src/background    the only fetch surface: demo edge client, context menu, offline encode
src/popup         Findings card, copy/download actions
src/shared        pure analysis, findings model, gate, url + snippet helpers (unit-tested)
```

## Manual verification

The browser-only paths must be verified by loading the unpacked build, not by
scripting Chrome. Run `pnpm --filter @auraimage/extension build`, load
`apps/extension/dist` per the install steps, then walk this list.

### Ambient pass

1. Open an image-heavy site (a news homepage, an Unsplash gallery). A small mono
   badge sits over each image's top-left reading `format bytes` (for example
   `jpeg 412 KB`), with a warning dot on images that have flags.
2. Scroll and resize the window. Badges track their images smoothly and hide
   when their image scrolls out of view.
3. Hover a badge. A panel shows `WxH natural, WxH shown`, short flag lines, an
   independently labeled `est. saving` line when known, and an `optimize` button.
4. Open the popup. The Findings card shows the hostname, images/total/wasteful
   stats, the estimated LCP saving and the LCP image when known, four flag
   counts, and a "served via <Vendor>" line on a page using a known image CDN
   (try a site on Cloudinary or imgix). The footer reads `measured, not scored`
   and `auraimage.ai`.
5. Popup `copy markdown`: paste elsewhere. A markdown block with the stats,
   flags, and the `auraimage.ai` footer link appears, with no em dashes.
6. Popup `download png`: a 1200x630 PNG downloads. Confirm the text is legible
   and correctly colored (light text on the dark card, not solid black) and the
   footer reads `measured, not scored` / `auraimage.ai`.
7. Popup `copy agent prompt`: copies a prompt built from the page's public image
   URLs. This is never gated.
8. Popup `mute this site`: badges disappear on that host and the button flips to
   `unmute this site`. Reload the page and badges stay hidden. Unmute restores
   them.
9. Popup `toggle overlay`: badges hide and show on the current page.

### Demo transform (click-triggered edge)

10. Hover a badge and click `optimize`. The panel opens with `measuring...`,
    then the before/after line with real numbers (for example
    `original 4.2 MB jpeg, avif 180 KB, saves 96%`), a webp line, and a blurhash
    canvas at the image's aspect ratio.
11. The smart-crop strip shows three thumbnails labeled cover / face / auto, each
    with its own loading state and then an image.
12. `download avif` and `download webp` save files named `<image>.avif` and
    `<image>.webp`.
13. `copy <picture> snippet` puts a valid `<picture>` block on the clipboard and
    counts as an export.
14. On a page with a `cdn.auraimage.ai` image, the popup offers `copy <picture>
    snippet` built from the real project and name; it gates after the allowance.
15. `suggest alt` shows a textarea with alt text plus `copy alt`. On an edge
    without a vision key it reads `alt suggestions are not configured`.
16. Click `optimize` on a `data:` or `http:` image: it shows that the image needs
    a public https URL and fires no request.
17. Open the panel, then quickly open it on a different image. No stats,
    thumbnails, or alt from the first image bleed into the second.
18. `Esc`, a backdrop click, and `close` all dismiss the panel.

### Context menu and offline compress

19. Right-click an `<img>`. The `AuraImage` submenu shows `Optimize this image`
    and `Download as WebP (offline)`.
20. `Optimize this image` opens the panel for that specific image.
21. `Download as WebP (offline)` on a same-origin JPEG or PNG downloads
    `<name>.webp`, smaller than the original, and it opens as a valid image.
22. Repeat on a cross-origin image (a CDN photo). It still downloads a valid
    WebP, proving the service-worker fetch keeps the canvas origin-clean.
23. Repeat on a very large image (a multi-megapixel photo, for example
    6000x4000). It still downloads a valid WebP. This exercises the chunked
    base64 marshaling in `offline-encode.ts` that a small image never reaches.
24. Filenames: `photo.jpg?v=2#x` becomes `photo.webp`; an extension-less URL
    becomes `<last-segment>.webp`; a `data:` or `blob:` image becomes
    `image.webp`.
25. Right-click an SVG or an undecodable resource: a `could not compress this
    image offline` toast appears and nothing crashes.

### Gate, walls, options, theming

26. After 3 total exports (panel downloads, copy-snippet, and offline saves all
    count, across tabs) the export controls become the gate CTA linking
    `auraimage.ai` with `utm_medium=gate`; the offline menu item shows the gate
    toast and does not download or increment the counter.
27. When the daily edge ceiling is hit or the edge returns 429, the panel shows
    the inline wall linking `auraimage.ai` with `utm_medium=wall`.
28. Options: a non-https edge base shows an error; a valid https value saves;
    empty reverts to the production default; the counter reads
    `free exports used: n / 3`.
29. Restricted pages (`chrome://extensions`, the Chrome Web Store): the popup
    shows `Can't read this page.`; the offline menu item does nothing, surfaces
    no error, and leaves the export counter unchanged.
30. Dark and light: badges, the hover panel, the popup, the options page, and the
    downloaded PNG all use the correct hue-260 neutrals in both schemes.
31. Regression: after using the optimize panel, ambient badges and hover panels
    are still fully styled. The overlay and the panel share one shadow root, and
    each must inject its own CSS regardless of construction order.

## Privacy

The Ambient pass runs entirely in your browser. It reads the images on the page
you are viewing and nothing else. Most click actions send exactly one thing to
the AuraImage demo endpoint: the image URL. The exception is `suggest alt`,
which forwards the resized image bytes (never your browsing history) to Google's
Gemini API (`generativelanguage.googleapis.com`) to write the description, and
only when you click it. AuraImage persists nothing either way (ADR 0024), there
is no analytics, and no browsing history is collected or transmitted; Google
applies its own data handling to the alt call. The full policy is in
[PRIVACY.md](./PRIVACY.md).

## Open source

The extension is open source. The broad host permission ("read and change all
your data on all websites") is what makes ambient badges on every page possible.
Open source is the mitigation: the permission usage is auditable, not asserted.
Read the source, build it yourself, and load your own `dist/`.

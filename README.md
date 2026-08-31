# AuraImage X-Ray

[![Images powered by AuraImage](https://img.shields.io/badge/Images%20powered%20by-AuraImage-0b0b0b?style=flat-square)](https://auraimage.ai)

[![CI](https://github.com/auraimage/chrome-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/auraimage/chrome-extension/actions/workflows/ci.yml)

A zero-auth browser extension that audits and optimizes the images on any page:
real AVIF/WebP on click, alt text, and page-speed findings. Measured, not
scored.

**Landing page:** https://auraimage.ai/extension

**Chrome Web Store:** coming soon · **Firefox Add-ons:** coming soon · **Edge Add-ons:** coming soon

AuraImage X-Ray is a zero-auth image auditor for the browser. It runs on any
website, for anyone, with no account. It badges every image on the current page
with its format and transfer size, flags the wasteful ones (oversized for their
display box, missing `alt`, no `srcset`), and rolls the page up into a shareable
Findings card of real, falsifiable measurements. Click an image to run the live
edge demo: a genuine before/after (AVIF and WebP re-encode, smart-crop,
blurhash) fetched from the AuraImage CDN. There is no synthesized composite
number. The findings are measured, not scored. The full rationale, including why
this is the product's first unauthenticated public route, is recorded in the
product's ADR 0024; the short version lives on
[auraimage.ai/extension](https://auraimage.ai/extension).

## Install (unpacked)

```bash
pnpm install
pnpm build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `.output/chrome-mv3/` directory.

Chrome shows the "read and change all your data on all websites" warning. That
is the cost of ambient badges on every page; see the open-source note below.

**Edge** loads the same Chrome build: `.output/chrome-mv3/` via
`edge://extensions`. **Firefox** uses an MV2 build (ADR 0029) — run
`pnpm build:firefox` and load `.output/firefox-mv2/` via `about:debugging` →
**This Firefox** → **Load Temporary Add-on**, or just `pnpm dev:firefox`, which
launches Firefox with the extension loaded and hot-reloads on change.

## Development

Built with [WXT](https://wxt.dev).

```bash
pnpm dev           # WXT dev server: opens Chrome with the extension, HMR + auto-reload
pnpm dev:firefox   # same, in Firefox (loads .output/firefox-mv2 via web-ext)
pnpm build         # one-shot production build into .output/chrome-mv3/
pnpm build:firefox # Firefox MV2 build into .output/firefox-mv2/
pnpm zip           # package .output/auraimage-x-ray-<version>-chrome.zip for the store
pnpm zip:firefox   # package the Firefox zip plus the AMO sources zip
pnpm test          # vitest on WxtVitest + fake-browser
pnpm test:e2e      # Playwright: load the built extension in real Chrome
pnpm type-check    # wxt prepare && tsc --noEmit
pnpm lint          # eslint
```

`pnpm dev` runs the WXT dev server, which launches its own Chrome with the
extension loaded and hot-reloads on change — no manual `chrome://extensions`
reload. The four entrypoints live under `src/entrypoints` (`background.ts` and
`content.ts` as `defineBackground`/`defineContentScript`, `popup/` and
`options/` as HTML pages); everything else under `src/` is plain library code.
WXT generates `manifest.json` from `wxt.config.ts`. It targets Chrome/Edge as
MV3 and Firefox as MV2 from one source, using the `browser` global and
promise-based messaging so a single code path runs on all three (ADR 0029). CI
builds the Firefox target and asserts its MV2 manifest; the messaging
round-trips are unit-tested against a promise-returning mock (Firefox's native
`browser` is promise-based, unlike Chrome's callbacks). Playwright can't load
extensions in Firefox, so the interactive Firefox smoke via `pnpm dev:firefox`
is a one-time manual check.

To point a dev build at a local or staging edge, set `WXT_EDGE_BASE` in
`.env.development` (default `https://cdn.auraimage.localhost`); `getEdgeBase`
resolves a runtime `chrome.storage.sync` override first, then that env var, then
the production default. Production bundles carry no dev env var.

`pnpm test` runs the unit suite on WXT's `fake-browser`; the "extension loads in
a real Chrome" class (broken manifest, service worker that never registers,
content script that crashes) is covered by the Playwright e2e (`pnpm test:e2e`),
which loads the built `.output/chrome-mv3/` via the `chromium` channel.

## Releasing

The version lives in exactly one place: `version` in `package.json` (WXT derives
the manifest version from it). To cut a release, bump that field, commit, and
push a matching tag:

```bash
# edit package.json: "version": "0.1.0"
git commit -am "release: v0.1.0"
git tag v0.1.0
git push --tags
```

The `v*` tag triggers `.github/workflows/release.yml`, which:

1. Fails fast unless the tag equals `v{package.json version}`, so a mistyped tag
   or a forgotten version bump stops the run before anything ships.
2. Runs the full CI gauntlet (lint, type-check, test, build, zip Chrome +
   Firefox, verify the Firefox MV2 manifest, e2e).
3. Creates a GitHub Release named after the tag with generated notes and the
   Chrome and Firefox zips attached.
4. Submits to the Chrome Web Store, Firefox Add-ons, and Edge Add-ons via
   `wxt submit` — each store independently, and only when its own secrets are
   configured. A store with no secrets is skipped with a run notice; the GitHub
   Release is still created either way. Edge reuses the Chrome zip; Firefox
   submits its own zip plus the AMO sources zip.

Store submission secrets are read by `wxt submit` — run `wxt submit init` to
scaffold `.env.submit` with the exact set. Each store gates on its identity var
(`CHROME_EXTENSION_ID` / `FIREFOX_EXTENSION_ID` / `EDGE_PRODUCT_ID`):

- **Chrome Web Store** — `CHROME_EXTENSION_ID` (the item ID from its store URL),
  `CHROME_CLIENT_ID` + `CHROME_CLIENT_SECRET` (a Google Cloud OAuth 2.0 client,
  Desktop type, with the Chrome Web Store API enabled), and `CHROME_REFRESH_TOKEN`
  (minted once for the `https://www.googleapis.com/auth/chromewebstore` scope).
- **Firefox Add-ons (AMO)** — `FIREFOX_EXTENSION_ID` (matches
  `browser_specific_settings.gecko.id`, `x-ray@auraimage.ai`), `FIREFOX_JWT_ISSUER`
  + `FIREFOX_JWT_SECRET` (an AMO API credential).
- **Edge Add-ons** — `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY` (from
  Partner Center).

If the store submit fails after the GitHub Release is already created (an expired
refresh token, a Google-side outage), do not retag. Re-run the release from the
Actions tab: pick the `release` workflow, choose **Run workflow**, and select the
existing `vX.Y.Z` tag as the ref. The run detects the existing GitHub Release and
re-attaches the zip with `--clobber` instead of failing, then retries the store
submit. A `workflow_dispatch` run pointed at a branch instead of a tag fails fast
with a clear message.

## Architecture

Two surfaces, one rule: the ambient work is free and never talks to AuraImage;
every edge call is click-triggered and metered.

- **Ambient pass** (always-on, local analysis). The content script collects
  DOM facts for each image (format, natural vs displayed dimensions, `alt`,
  `loading`, `srcset`, bytes from the Resource Timing API), analyzes them
  locally, badges the page through a shadow-DOM overlay, and feeds the popup's
  Findings card. It never talks to the AuraImage edge. Its one network behavior
  is the **Size probe** (ADR 0026): when a cross-origin server withholds byte
  sizes from Resource Timing (no `Timing-Allow-Origin`), the extension
  re-requests the image from its own host to measure it — normally a
  browser-cache hit, with a background fallback capped at 10 real downloads per
  page. It is unlimited and free; offline, sizes the browser hides simply stay
  unknown and the hover panel says why.
- **Demo transform** (click-triggered edge). Clicking an image's `optimize`
  action sends one thing to the demo endpoint: the image URL. The endpoint is
  anonymous, stateless, and rate-limited; it runs the real serve pipeline
  (AVIF/WebP encode, smart-crop, blurhash) and persists nothing. This is what
  produces the real before/after proof, so the extension is a live demo of the
  AuraImage edge rather than a mock.
- **Export gate**. Seeing the audit is always free. Keeping the optimized output
  is not: `download avif`, `download webp`, the `<picture>` snippet copy, and the
  offline WebP save each spend one of three free exports. The panel shows how
  many are left, and once they are spent its export controls collapse into a
  single "create a free project" row. The cost circuit-breaker and the
  conversion wall are deliberately the same wall.
- **Offline compress**. Right-click an image and pick `Download as WebP
  (offline)` to decode and re-encode entirely on-device via `OffscreenCanvas`,
  no network. AVIF wasm was the design target; WebP shipped because it is
  verifiable in the service worker without a wasm bundle or a CSP change. The
  codec is a swappable seam (`OFFLINE_EXT` and `OFFLINE_MENU_TITLE` in
  `src/shared/context-menu.ts`, plus `encodeOffline`'s body); see ADR 0024 and
  the note in `src/background/offline-encode.ts`.

Code map:

```
src/entrypoints   background, content, popup, options (the four WXT entrypoints)
src/content       ambient overlay, badges, size probe, optimize panel, offline-download UI
src/background    demo edge client, context menu, offline encode, size-probe fallback
src/popup         Findings card, copy/download actions
src/shared        pure analysis, findings model, gate, url + snippet helpers (unit-tested)
```

## Manual verification

The browser-only paths must be verified by loading the unpacked build, not by
scripting Chrome. Run `pnpm build`, load `.output/chrome-mv3/` per the install
steps, then walk this list.

### Ambient pass

1. Open an image-heavy site (a news homepage, an Unsplash gallery). A small mono
   badge sits over each image's top-left reading `format bytes` (for example
   `jpeg 412 KB`), with a warning dot on images that have flags and an `lcp` tag
   on the page's LCP image.
2. Scroll and resize the window. Badges track their images smoothly and hide
   when their image scrolls out of view.
3. Hover a badge. A panel shows `WxH natural, WxH shown`, short flag lines, an
   independently labeled `est. saving` line when known, and an `optimize` button.
4. Open the popup. The Findings card shows the hostname over an `N images ·
   total` line, the estimated wasteful bytes as the headline figure, the
   estimated LCP saving and the LCP image when known, four flag counts, a `fix
   first` list of up to three https images ranked by estimated saving, and a
   "served via <Vendor>" line on a page using a known image CDN (try a site on
   Cloudinary or imgix). Click a `fix first` row: the popup closes and the
   optimize panel opens on that image. Click a fired flag row (`oversized 5`):
   the row presses and shows `on page`, and on the page every matching image
   gets a frame, the other badges dim, the first match scrolls into view, and a
   bar above the `x-ray` pill reads `oversized 1 of 5` with `‹` `›` to step
   through the matches and `×` to clear (Escape clears too). The `LCP image`
   row does the same in the accent tone. Reopen the popup: the row is still
   pressed; press it again to clear. The frames and the bar still appear on a
   host whose badges are hidden. The footer reads `measured, not scored`, then
   `options` (opens the options page) and `auraimage.ai`.
5. Popup `copy markdown`: paste elsewhere. A markdown block with the stats,
   flags, and the `auraimage.ai` footer link appears, with no em dashes.
6. Popup `download png`: a 1200x630 PNG downloads. Confirm the text is legible
   and correctly colored (light text on the dark card, not solid black) and the
   footer reads `measured, not scored` / `auraimage.ai`.
7. Popup `copy agent prompt`: copies a prompt built from the page's public image
   URLs. This is never gated.
8. Popup `badges on <host>` switch: turn it off and badges disappear on that
   host. Reload the page and badges stay hidden; turning it back on restores
   them. The `badges on every site` switch does the same for all sites, and the
   per-host switch is disabled while it is off.

### Demo transform (click-triggered edge)

9. Hover a badge and click `optimize`. The panel opens as a modal dialog titled
   with the image's file name, shows a loading skeleton, then the headline
   saving (for example `saves 2.1 MB (92%)`) over three measured bars
   (original, avif, webp) and a blurhash canvas at the image's aspect ratio.
   The `exports` row reads `3 of 3 free left`.
10. The smart-crop strip shows three thumbnails labeled cover / face / auto, each
    with its own loading state and then an image.
11. `download avif` and `download webp` save files named `<image>.avif` and
    `<image>.webp`.
12. `copy <picture>` puts a valid `<picture>` block on the clipboard, flashes
    `copied`, and counts as an export (the `exports` counter drops by one).
13. On a page with a `cdn.auraimage.ai` image, the popup offers `copy <picture>
    snippet` built from the real project and name; it gates after the allowance.
14. `suggest alt text` (its hint says the resized image goes to Google Gemini)
    shows a textarea with alt text plus `copy alt`. On an edge without a vision
    key it reads `Alt suggestions are not configured on this edge.`
15. Click `optimize` on a `data:` or `http:` image: it shows that the image needs
    a public https URL and fires no request.
16. Open the panel, then quickly open it on a different image. No stats,
    thumbnails, or alt from the first image bleed into the second.
17. `Esc`, a backdrop click, and `close` all dismiss the panel, and keyboard
    focus returns to the badge that opened it.

### Context menu and offline compress

18. Right-click an `<img>`. The `AuraImage` submenu shows `Optimize this image`
    and `Download as WebP (offline)`.
19. `Optimize this image` opens the panel for that specific image.
20. `Download as WebP (offline)` on a same-origin JPEG or PNG downloads
    `<name>.webp`, smaller than the original, and it opens as a valid image.
21. Repeat on a cross-origin image (a CDN photo). It still downloads a valid
    WebP, proving the service-worker fetch keeps the canvas origin-clean.
22. Repeat on a very large image (a multi-megapixel photo, for example
    6000x4000). It still downloads a valid WebP. This exercises the chunked
    base64 marshaling in `offline-encode.ts` that a small image never reaches.
23. Filenames: `photo.jpg?v=2#x` becomes `photo.webp`; an extension-less URL
    becomes `<last-segment>.webp`; a `data:` or `blob:` image becomes
    `image.webp`.
24. Right-click an SVG or an undecodable resource: a `could not compress this
    image offline` toast appears and nothing crashes.

### Gate, walls, options, theming

25. After 3 total exports (panel downloads, copy-snippet, and offline saves all
    count, across tabs) the panel's three export controls collapse into one
    gate row, and the popup's snippet button into a `3 of 3 free exports used`
    note, each with a single `create a free project` link to `auraimage.ai`
    with `utm_medium=gate`; the offline menu item shows the gate toast and does
    not download or increment the counter.
26. When the daily edge ceiling is hit, the panel shows the inline wall linking
    `auraimage.ai` with `utm_medium=wall`; a transient 503, timeout, or plain
    429 shows the message with a `retry` button instead.
27. Options: a non-https edge base shows an error under the field in the loss
    tone; a valid https value saves with a confirmation in the win tone; empty
    reverts to the production default; the free exports line reads
    `n of 3 used, k left` beside a three-segment meter.
28. Restricted pages (`chrome://extensions`, the Chrome Web Store): the popup
    shows `Can't read this page`; the offline menu item does nothing, surfaces
    no error, and leaves the export counter unchanged. A page with no `<img>`
    elements shows `no images rendered` under the hostname, with the two badge
    switches still available.
29. Dark and light: badges, the hover panel, the popup, the options page, and the
    downloaded PNG all use the correct hue-260 neutrals in both schemes.
30. Regression: after using the optimize panel, ambient badges and hover panels
    are still fully styled. The overlay and the panel share one shadow root, and
    each must inject its own CSS regardless of construction order.
31. Size probe: on a page whose images live on another origin without
    `Timing-Allow-Origin` (subdomain CDNs are common), badges still show real
    byte sizes after a moment. When a size truly cannot be measured, the hover
    panel shows `size unavailable (cross-origin)` instead of silently omitting
    it.
32. On-page switcher: a pill reading `x-ray · N ▾` sits bottom-right on any page
    with badges. Clicking it opens a menu (`aura x-ray` with a `help` link, then
    `hide on <host>` and `hide on every site`) and changes nothing by itself.
    `hide on every site` hides badges in every open tab and collapses the pill
    to a dot; clicking the dot reopens the menu, now leading with `show on every
    site`. The popup's `badges on every site` switch flips the same state.
    `hide on <host>` removes badges and the switcher on that host only, and the
    popup's `badges on <host>` switch restores them. Escape, or a click anywhere else,
    closes the menu; opening it closes any pinned badge panel. Muted sites show
    neither badges nor the pill.

## Privacy

The Ambient pass runs in your browser and never reaches AuraImage. It reads the
images on the page you are viewing; when a cross-origin server hides an image's
byte size from Resource Timing, it re-requests that image from its own host to
measure it (usually a cache hit, capped — see PRIVACY.md). Most click actions
send exactly one thing to the AuraImage demo endpoint: the image URL. The exception is `suggest alt text`,
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
Read the source, build it yourself, and load your own `.output/chrome-mv3/`.

---

Images powered by [AuraImage](https://auraimage.ai) — the image CDN that
installs itself. Set it up in any project with `npx aura init`, or from your
AI agent with [Agent Skills](https://github.com/auraimage/skills) and the
[MCP server](https://github.com/auraimage/mcp-server).

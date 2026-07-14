# Chrome Web Store listing (draft)

Draft copy for the Chrome Web Store submission, tuned for store search.
Publishing is a human decision; this file is the source text.

## Title (75 char max)

> Image Optimizer & Audit: AVIF, WebP, Alt Text | AuraImage X-Ray

(63 characters. Leads with the searchable phrase, keeps the brand at the end.)

## Summary (132 char max)

> Image optimizer and audit: AVIF/WebP on click, alt text, Core Web Vitals. Zero auth, open source, measured, not scored.

(119 characters.)

## Category

Developer Tools

## Full description

Audit and optimize every image on any page. AuraImage X-Ray badges each image
with its real format and transfer size, flags the wasteful ones (oversized for
their display box, missing alt text, no srcset), and on click runs a genuine
AVIF and WebP optimization on the AuraImage edge. It is an image optimizer and
page-weight auditor for developers who care about page speed and Core Web
Vitals. The findings are real, falsifiable measurements with no invented health
number: measured, not scored.

What it does:

- **Ambient image audit, local-first.** Every image on the page is badged with
  its format and real transfer size, and the wasteful ones are flagged. Nothing
  is sent to AuraImage for this; when a cross-origin server hides an image's
  size from the browser, the extension re-requests the image from its own host
  to measure it (usually straight from your cache, capped per page).
- **Real AVIF and WebP optimization on click.** AuraImage fetches the image,
  re-encodes it to AVIF and WebP, and runs smart-crop and blurhash, handing back
  a genuine before and after (for example 4.2 MB JPEG to 180 KB AVIF), not an
  estimate.
- **Copy-ready output.** Download the optimized AVIF or WebP, or copy a
  ready-to-paste `<picture>` snippet straight into your markup.
- **Alt text on demand.** Generate descriptive alt text for any image, powered
  by Google Gemini.
- **Offline WebP compression.** Right-click any image to save a smaller WebP,
  encoded entirely on your own device with no network call.
- **Shareable Findings card.** Roll the whole page up into a card with hostname,
  image and byte totals, the wasteful count, estimated LCP saving, and flag
  counts. Copy it as markdown or download it as a PNG.
- **Zero auth.** No account, no sign-in. It works on any site, for anyone.

Your privacy: the audit never reaches AuraImage. The ambient pass talks only to
hosts the page already loaded images from, and only to measure sizes the
browser hides. The only thing a click sends is the image URL, to a stateless
endpoint that persists nothing. The one
exception is alt text, which forwards the resized image bytes to Google's Gemini
API only when you ask for it. No analytics, no browsing history, no tracking.
The full policy is linked below.

Open source: the extension is open source, so the broad host permission it needs
to badge images on every page is auditable, not asserted. Read the source, build
it yourself, and load your own copy.

Built by AuraImage, an AI-native image CDN for developers.

## Links

- Landing page: https://auraimage.ai/extension
- Privacy policy: https://github.com/auraimage/chrome-extension/blob/main/PRIVACY.md
- Source code: https://github.com/auraimage/chrome-extension
- Support and contact: https://github.com/auraimage/chrome-extension/issues

## Screenshot shot-list (5)

1. **Badges on a heavy page.** An image-dense homepage (a news site or a photo
   gallery) with the mono badges sitting over each image, warning dots on the
   flagged ones. This is the ambient hook: the whole page, X-rayed at a glance.
2. **The Findings card.** The popup open on that page: hostname, images / total
   bytes / wasteful count, estimated LCP saving, the four flag counts, and the
   `measured, not scored` footer. The screenshot-ready artifact.
3. **Before/after panel.** The optimize panel on one image: a `saves 1.1 MB
   (78%)` headline over color-coded byte bars (red for the original, green for
   avif/webp), the blurhash preview, and the smart-crop strip. Numbers come
   from the live edge on a real image — proof, not estimate.
4. **Smart-crop strip.** The three-thumbnail strip labeled cover / face / auto,
   showing the AI-native crop the plain browser compressor cannot do.
5. **Competitor wedge line.** The popup on a page served by a known image CDN,
   with the "served via <Vendor>" line visible: the moment the tool names the
   incumbent and shows where AuraImage would ship it smaller.

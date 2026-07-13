# Chrome Web Store listing (draft)

Draft copy for the Chrome Web Store submission. Publishing is a human decision;
this file is the source text.

## Name

AuraImage X-Ray

## Summary (132 char max)

> See what every image on a page really costs. Real AVIF/WebP before/after on click. Zero auth, open source. Measured, not scored.

(128 characters.)

## Category

Developer Tools

## Full description

AuraImage X-Ray badges every image on the page with its format and transfer
size, then flags the ones costing you: oversized for their display box, missing
alt text, no srcset. Open the popup for a Findings card you can copy or
screenshot. It is real, falsifiable measurements with no invented health number.
Measured, not scored.

Click any image to run a live edge demo. AuraImage fetches it, re-encodes it to
AVIF and WebP, runs smart-crop and blurhash, and hands back a genuine
before/after: 4.2 MB JPEG to 180 KB AVIF, not an estimate. Download the
optimized file, copy a ready-to-paste `<picture>` snippet, or generate alt text.
Right-click any image to save an offline WebP, encoded entirely on your device.

Zero auth. No account, no sign-in. It works on any site, for anyone.

The audit never leaves your browser. The only thing a click sends is the image
URL, to a stateless endpoint that persists nothing. No analytics. No browsing
history. The extension is open source, so the permission it asks for is
auditable, not asserted.

Built by AuraImage, an AI-native image CDN for developers.

## Screenshot shot-list (5)

1. **Badges on a heavy page.** An image-dense homepage (a news site or a photo
   gallery) with the mono badges sitting over each image, warning dots on the
   flagged ones. This is the ambient hook: the whole page, X-rayed at a glance.
2. **The Findings card.** The popup open on that page: hostname, images / total
   bytes / wasteful count, estimated LCP saving, the four flag counts, and the
   `measured, not scored` footer. The screenshot-ready artifact.
3. **Before/after panel.** The optimize panel on one image showing the real
   line (`original 4.2 MB jpeg, avif 180 KB, saves 96%`), the webp line, and the
   blurhash preview. Proof, not estimate.
4. **Smart-crop strip.** The three-thumbnail strip labeled cover / face / auto,
   showing the AI-native crop the plain browser compressor cannot do.
5. **Competitor wedge line.** The popup on a page served by a known image CDN,
   with the "served via <Vendor>" line visible: the moment the tool names the
   incumbent and shows where AuraImage would ship it smaller.

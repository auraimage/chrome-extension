# Privacy Policy

**Extension:** AuraImage X-Ray
**Last updated:** 2026-07-13

AuraImage X-Ray audits the images on the page you are viewing. It is built so
that the audit itself never leaves your browser. This policy states exactly what
the extension does and does not send.

## What the extension collects

Nothing, in the always-on case. The Ambient pass (the badges and the Findings
card) is 100% client-side. It reads the images already loaded on the current
page (their format, dimensions, `alt`, `loading`, `srcset`, and transfer size
from the browser's Resource Timing API) and analyzes them locally. No page
content, no image bytes, and no URLs are transmitted anywhere for this.

## What a click sends

The extension calls the network only when you explicitly click an edge action
(`optimize`, `download avif`, `download webp`, `copy <picture> snippet`, or
`suggest alt`). For every action except `suggest alt`, it sends exactly one
thing to the AuraImage demo endpoint: **the URL of the image you clicked**. The
endpoint fetches that image, runs the AuraImage transform pipeline (AVIF/WebP
encode, smart-crop, blurhash), and returns the result. It is anonymous and
stateless: it **persists nothing** about you, the image, or the page you found
it on (ADR 0024). No account, sign-in, or personal identifier is involved.

The offline WebP save (`Download as WebP (offline)`) sends nothing at all. It
fetches and re-encodes the image entirely on your device.

## What `suggest alt` sends to Google

`suggest alt` is the one action that reaches beyond AuraImage. To write the
description, the AuraImage edge resizes the image you clicked and forwards those
**resized image bytes** to Google's Gemini API
(`generativelanguage.googleapis.com`), which returns the suggested text. Only
the image bytes are sent, and only when you press `suggest alt`. Your browsing
history, the page URL, and any personal identifier are never part of that call.
AuraImage still **persists nothing** from it (ADR 0024); Google processes the
bytes under its own data handling terms. If you never click `suggest alt`,
nothing is ever sent to Google.

## What is stored locally

The extension keeps a small amount of state in your browser's extension storage,
synced to your own browser profile by Chrome. This never goes to AuraImage:

- the list of sites you have muted,
- the count of free exports you have used,
- an optional custom edge endpoint (for self-hosting or testing).

## What the extension does not do

- No analytics, telemetry, or usage tracking of any kind.
- No browsing history is read, stored, or transmitted.
- No cookies, no fingerprinting, no advertising identifiers.
- No selling or sharing of your data for advertising or analytics. The one
  exception is the `suggest alt` image bytes sent to Google, described above, and
  only when you invoke it.

## Permissions

- **Host access on all sites** (`<all_urls>`): required to badge images on
  whatever page you are viewing. The extension only ever reads image data from
  the active page, and only sends a URL when you click.
- **`storage`**: the local, on-device state listed above.
- **`contextMenus`**: the right-click `AuraImage` menu.
- **`clipboardWrite`**: writing the Findings markdown, agent prompt, or
  `<picture>` snippet to your clipboard when you ask for it.

## Open source

The extension is open source, so every claim in this policy is checkable against
the code. Read it, build it, and load your own copy.

## Changes

If this policy changes, the updated version ships with the extension and the date
above changes with it.

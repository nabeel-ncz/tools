# QA Report — NABL Tools

Full QA pass against the real, running site: real headless Chromium (pre-installed
in this sandbox), real fake media devices (camera/mic/screen-capture), real engines
(ffmpeg.wasm, onnxruntime-web, pdf-lib/pdf.js, tesseract.js), and a real local
Cloudflare Worker (`wrangler dev`) for File Drop's signaling. No mocking.

**Sandbox network policy note:** this environment's egress proxy blocks
`huggingface.co`, `cdn.jsdelivr.net`, and `unpkg.com` (confirmed via direct `curl`
— explicit HTTP 403 policy denial, not a flaky connection). Two real fixes came out
of this: `ffmpeg.wasm` and `onnxruntime-web`'s WASM runtime are now **self-hosted**
(bundled at build time via Vite, no CDN dependency) instead of CDN-fetched — this
also let Video Compressor, Background Remover, and Image Upscaler be tested for
real instead of just code-reviewed. Whisper model weights (Transcriber) and
tesseract.js's language data (OCR) still depend on external hosts with no viable
self-hosted alternative, so those two tools' *real inference* remains unverified
here — see the table below for exactly what was and wasn't checked for each.

## Page-by-page results

| Page | E2E | Trust Meter | Notes |
|---|---|---|---|
| Home, /video, /pdf, /image, /devices | n/a (static) | n/a | Lighthouse 100/100/100/100, axe clean |
| webcam-test | ✅ real fake camera, resolution/FPS readout | ✅ 0 bytes | |
| mic-test | ✅ real fake mic (speech.wav), VU meter movement, record clip | ✅ 0 bytes | |
| screenshot-beautifier | ✅ real upload/style/export, PNG+JPG magic bytes verified | ✅ 0 bytes | |
| favicon-generator | ✅ real zip contents verified (9 files) | ✅ 0 bytes | |
| pdf-compressor | ✅ real compress; found+fixed never-larger-than-input bug | ✅ 0 bytes | |
| merge-pdf | ✅ real merge, page count + text content verified | ✅ 0 bytes | |
| split-pdf | ✅ both modes (extract, per-page zip) | ✅ 0 bytes | |
| sign-pdf | ✅ real signature placement, XObject count verified | ✅ 0 bytes | |
| redact | ✅ **"ALPHA-REDACT-ME" confirmed genuinely unextractable**; untouched pages intact | ✅ 0 bytes | core privacy claim verified |
| screen-recorder | ✅ real capture, valid WebM output, mic+webcam bubble tested | ✅ 0 bytes | |
| video-compressor | ✅ **real ffmpeg transcode**, MP4/WebM/GIF verified, self-hosted engine confirmed | ✅ 0 bytes | |
| transcribe | ⚠️ UI/error-handling verified only | ✅ 0 bytes | real HF request confirmed, graceful error; inference NOT testable here |
| ocr | ⚠️ UI/error-handling verified only | ✅ 0 bytes | real jsdelivr request confirmed, graceful error; inference NOT testable here |
| remove-background | ⚠️ ONNX runtime self-hosting verified live | ✅ 0 bytes | model weights (HF) unreachable here; inference NOT testable |
| image-upscaler | ⚠️ ONNX runtime self-hosting verified live | ✅ 0 bytes | same as above |
| file-drop | ✅ **real two-device P2P transfer, SHA-256 byte-exact match** | ✅ verified via frame inspection | real bug found+fixed (sender progress UI) |
| 404, about, privacy, changelog | ✅ render correctly | n/a | |

**PWA offline**: cached pages survive offline reload after a real visit; one real
finding (not fixed, documented as a UX judgment call): a page's *very first* visit
can't be offline-cached by its own service-worker install, so an offline reload of
an only-once-visited page silently serves the cached homepage instead of an
explicit "you're offline" notice.

## SEO — 345/346 automated checks passed

Full script: `scripts/seo-audit.mjs` (results in `qa/seo-audit.json`). Covers
title/description length+uniqueness, canonical, OG/Twitter tags + image existence,
JSON-LD validity per required `@type`, sitemap/robots correctness, full internal
link graph (345 links, 0 broken), and no-JS content visibility. Found and fixed:
6 page titles over the 60-char budget. One low-impact, undone issue: the special
`/404` route's canonical resolves to `/404/` vs the emitted `/404.html` — an
inherent Astro static-build quirk; 404 isn't linked or sitemapped, so no real SEO
impact. IndexNow key + ping script added (`docs/indexnow.md`) but unverifiable
live here — needs a real deploy.

## Performance — Lighthouse (mobile), all 21 routes

**Every page: Performance 100, Accessibility 96-100 → now 100 post-fix,
Best Practices 96-100, SEO 100.** Found and fixed a real ~200KB initial-JS budget
violation across 5 PDF tools (static `import` of `pdf-lib` instead of the lazy
`await import()` pattern used everywhere else) — all 5 now load ~30KB, within the
60KB budget. Full detail: `qa/lighthouse-summary.md`.

## Accessibility — axe-core, final run: 24/24 pass, zero serious/critical

Two real violations found and fixed during the audit (missing accessible name on
the shared file-input Dropzone; a serious `nested-interactive` violation from a
`div[role=button]` wrapping a real `<input>` — now a native `<label>`). A
color-contrast issue was then found in **two waves**: first, the shared
`--fg-faint` token (2.89:1, fixed to 4.77:1 light / 5.14:1 dark by the design
review pass); then, on a final independent re-verification, the brand `--signal`
vermilion used directly as text color (CTA button labels, error text) was also
below AA (3.27–3.68:1) — added a dedicated `--signal-text` token and swept every
text usage site-wide. **Final full axe run: 24/24 tests pass, 0 violations.**

Keyboard audit (`qa/keyboard-audit.md`): Command Palette fully operable. Found+
fixed a real gap — every slider control had no visible focus indicator (global
`:focus-visible` was silently defeated by a native-outline reset with no
replacement). One documented, unfixed gap: Sign & Fill's placed-element
drag/resize is pointer-only (real feature work, not a safe small fix).

## Security headers — `public/_headers`, live-tested

Built from an actual grep of every external URL in `src/` plus each engine's setup
code, then live-tested through a header-injecting local proxy against real
Chromium across all 21 pages. Found and fixed two real bugs in the process
(an invalid STUN entry in the CSP source-list; a missing `media-src` blocking
blob-URL audio/video playback). COOP/COEP successfully enabled for
video-compressor/remove-background/image-upscaler after discovering built assets
need their own CORP+COEP headers to load under a COEP page — confirmed
`self.crossOriginIsolated === true` with zero blocked requests afterward.

## Design review — 150 screenshots (25 pages × 3 widths × 2 themes)

No anti-brief violations found (no gradients/glassmorphism/card-grids/emoji). No
horizontal overflow at 360px on any page (scripted check, all 25 routes). Found
and fixed a real correctness bug: Screen Recorder's idle mic/webcam toggle buttons
inherited solid vermilion fill from an overly broad CSS selector, making an "on"
toggle render invisible text (signal-on-signal). One judgment call, documented not
changed: the vermilion signal color's restrained decorative use as the catalogue's
serial-number/wayfinding accent (header mark, "No. XX" labels) is a site-wide
identity choice, left for the brief owner rather than changed unilaterally.

## Build status

`npm run build` (`astro check && astro build`): **0 errors, 25/25 pages**, verified
clean as the final step of this QA pass.

## What's still open (see HANDOFF.md's Go/No-Go checklist for full detail)

- Real inference for Transcriber, OCR, Background Remover, Image Upscaler —
  blocked by this sandbox's network policy, not by any code defect found. Needs
  one real-browser pass with internet access.
- PWA first-visit-offline behavior (documented, not fixed — UX judgment call).
- Sign & Fill keyboard-only drag/resize (documented, not fixed — feature work).
- Safari/Firefox/real-device testing — not possible in this sandbox (Chromium only).
- Part 2 (launch assets) was not started this session — see HANDOFF.md.

# Lighthouse CI summary — NABL Tools

Mobile form factor (360x640, DPR 2, simulated throttling), Chromium at `/opt/pw-browsers/chromium`, run against `astro preview` serving a production `astro build`.

21 routes: homepage, 4 category hubs (`/video`, `/pdf`, `/image`, `/devices`), 16 tool pages.

## Scores

| Page | Path | Perf | A11y | Best Practices | SEO | Initial JS (transfer) |
|---|---|---:|---:|---:|---:|---:|
| home | `/` | 99 | 100 | 100 | 100 | 22.8 KB |
| video-hub | `/video/` | 100 | 100 | 100 | 100 | 22.8 KB |
| pdf-hub | `/pdf/` | 99 | 100 | 100 | 100 | 22.8 KB |
| image-hub | `/image/` | 100 | 100 | 100 | 100 | 22.8 KB |
| devices-hub | `/devices/` | 100 | 100 | 100 | 100 | 22.8 KB |
| favicon-generator | `/favicon-generator/` | 100 | 97 | 100 | 100 | 30.4 KB |
| file-drop | `/file-drop/` | 98 | 97 | 100 | 100 | 43.1 KB |
| image-upscaler | `/image-upscaler/` | 100 | 97 | 100 | 100 | 32.6 KB |
| merge-pdf | `/merge-pdf/` | 100 | 97 | 100 | 100 | 29.8 KB |
| mic-test | `/mic-test/` | 100 | 96 | 100 | 100 | 30.9 KB |
| ocr | `/ocr/` | 100 | 97 | 100 | 100 | 31.8 KB |
| pdf-compressor | `/pdf-compressor/` | 100 | 97 | 100 | 100 | 31.5 KB |
| redact | `/redact/` | 100 | 97 | 100 | 100 | 30.8 KB |
| remove-background | `/remove-background/` | 100 | 97 | 100 | 100 | 33.4 KB |
| screen-recorder | `/screen-recorder/` | 100 | 96 | 100 | 100 | 29.6 KB |
| screenshot-beautifier | `/screenshot-beautifier/` | 98 | 97 | 100 | 100 | 30.5 KB |
| sign-pdf | `/sign-pdf/` | 100 | 97 | 100 | 100 | 31.7 KB |
| split-pdf | `/split-pdf/` | 100 | 97 | 100 | 100 | 30.5 KB |
| transcribe | `/transcribe/` | 100 | 97 | 100 | 100 | 35.8 KB |
| video-compressor | `/video-compressor/` | 100 | 97 | 100 | 100 | 32.8 KB |
| webcam-test | `/webcam-test/` | 100 | 96 | 100 | 100 | 29.5 KB |

## Budget check: initial JS ≤ 60KB

Per the project's own performance budget, this counts only Script-type network requests captured during a normal (non-interacted) page load — i.e. the astro-island hydration runtime, the small tool Svelte component itself (client:visible), TrustMeter/CommandPalette, etc. It deliberately excludes the heavy engines (ffmpeg.wasm, onnxruntime-web, transformers.js, tesseract.js, pdf-lib) since those are dynamically `import()`-ed only inside click/action handlers and never appear in Lighthouse's cold-load network log unless the page eagerly bundles them.

**All 21 pages are within budget.** Highest is `file-drop` at 43.1KB (WebRTC signaling/pairing UI is bigger than a typical tool console but still well under 60KB).

### Fixed during this audit

Initially, **5 pages were over budget** — merge-pdf, pdf-compressor, redact, sign-pdf, split-pdf, each shipping ~200KB of initial JS (Performance scores 96-99). The cause: all 5 tool components did `import { PDFDocument } from 'pdf-lib'` as a static top-level import, so pdf-lib (~429KB raw / ~174KB gzipped, Rollup chunk named `PDFButton.js` after one of pdf-lib's own internal class names) got bundled into the eagerly-hydrated (`client:visible`) tool island instead of being deferred — unlike every other heavy dependency in this codebase (`ffmpegEngine.ts`, `onnxSetup.ts`, `pdf-shared/pdfjs.ts`, and even `jszip` inside these same files), which are all dynamically `import()`-ed inside their action handlers.

**Fix applied** (within the task's allowed scope, `src/tools/*/*.svelte`): converted the static `import { PDFDocument, ... } from 'pdf-lib'` in `MergePdf.svelte`, `SplitPdf.svelte`, `SignPdf.svelte`, `Redact.svelte`, and `PdfCompressor.svelte` to a dynamic `const { PDFDocument } = await import('pdf-lib')` inside each file's single async action handler (`merge()`, `run()`, `exportPdf()`, `flattenAndExport()`, `compressOne()`), matching the codebase's own established lazy-load convention. Re-ran Lighthouse after the fix: all 5 pages dropped to 29.8–31.7KB initial JS and Performance scores rose to 100 (split-pdf: 96→100).

## Pages below 90 in any category

**None.** After the pdf-lib fix and the Dropzone `aria-label` fix (below), every page scores ≥96 in every category.

## Accessibility findings from Lighthouse (below 100)

All 16 tool pages score 96 or 97 on Accessibility (down from 100 on the 5 static pages: home + 4 hubs, which have no interactive islands). Two Lighthouse audits were responsible:

1. **`label` (missing accessible name)** — the shared `Dropzone.svelte` primitive's hidden `<input type="file">` had no `aria-label`, `aria-labelledby`, or wrapping `<label>`. Affected every tool page that uses a Dropzone (13 of 16 — all except mic-test, screen-recorder, webcam-test, which use device permission buttons instead).
   - **Fixed**: added `aria-label={label}` to the hidden input in `src/design/primitives/Dropzone.svelte`, reusing the same text already shown visibly as the dropzone's label prop. Re-ran Lighthouse: this audit now passes on all pages (accessibility rose from 92 to 97 on the 13 affected tool pages).

2. **`color-contrast`** — remaining on all 16 tool pages (mic-test/screen-recorder/webcam-test only had this one; all others also had the `label` issue above). `TrustMeter.svelte`'s `.tm-key`, `.tm-engine`, and `.tm-note` text renders at a measured contrast ratio of **2.89:1** (foreground `#8a867b`, background `#eae5d9`, 12px/9pt), against the WCAG AA requirement of 4.5:1 for this text size. The color comes from the shared design token `--fg-faint` (→ `--color-ink-faint`) in `src/design/tokens.css`, used broadly across the design system for de-emphasized text (also `.dz-hint`, `.dz-icon` in Dropzone, etc.) — **not fixed here**: per this audit's own scope guidance, a token-level contrast fix is a real color-system redesign decision (it affects every "faint" text element site-wide, in both light/dark themes), left for the separate design-review pass to own holistically. Flagged here with exact numbers so that pass has what it needs.

## Best Practices / SEO

Best Practices is 100 on every page except `file-drop` (started at 96, now 100 after rebuild — see raw JSON for the one flagged audit if it recurs; it was `unminified-javascript`-class/console noise from the dev-only WebRTC path, not present in the final run). SEO is 100 on all 21 pages.

## Raw reports

Full Lighthouse JSON for every page is at `qa/lighthouse/<slug>.json` (gitignored). Route → slug mapping is in `qa/routes.json`.

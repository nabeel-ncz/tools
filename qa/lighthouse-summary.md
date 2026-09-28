# Lighthouse CI summary — NABL Tools

Mobile form factor (360x640, DPR 2, simulated throttling), Chromium at `/opt/pw-browsers/chromium`, run against `astro preview` serving a production `astro build`.

21 routes: homepage, 4 category hubs (`/video`, `/pdf`, `/image`, `/devices`), 16 tool pages.

## Scores

| Page | Path | Perf | A11y | Best Practices | SEO | Initial JS (transfer) |
|---|---|---:|---:|---:|---:|---:|
| home | `/` | 100 | 100 | 100 | 100 | 22.8 KB |
| video-hub | `/video/` | 100 | 100 | 100 | 100 | 22.8 KB |
| pdf-hub | `/pdf/` | 100 | 100 | 100 | 100 | 22.8 KB |
| image-hub | `/image/` | 100 | 100 | 100 | 100 | 22.8 KB |
| devices-hub | `/devices/` | 100 | 100 | 100 | 100 | 22.8 KB |
| favicon-generator | `/favicon-generator/` | 100 | 96 | 100 | 100 | 30.3 KB |
| file-drop | `/file-drop/` | 100 | 96 | 96 | 100 | 43 KB |
| image-upscaler | `/image-upscaler/` | 100 | 96 | 100 | 100 | 32.5 KB |
| merge-pdf | `/merge-pdf/` | 100 | 96 | 100 | 100 | 29.7 KB |
| mic-test | `/mic-test/` | 100 | 96 | 100 | 100 | 30.9 KB |
| ocr | `/ocr/` | 100 | 96 | 100 | 100 | 31.7 KB |
| pdf-compressor | `/pdf-compressor/` | 100 | 96 | 100 | 100 | 31.4 KB |
| redact | `/redact/` | 100 | 96 | 100 | 100 | 30.7 KB |
| remove-background | `/remove-background/` | 100 | 96 | 100 | 100 | 33.3 KB |
| screen-recorder | `/screen-recorder/` | 100 | 96 | 100 | 100 | 29.6 KB |
| screenshot-beautifier | `/screenshot-beautifier/` | 100 | 96 | 100 | 100 | 30.4 KB |
| sign-pdf | `/sign-pdf/` | 100 | 96 | 100 | 100 | 31.6 KB |
| split-pdf | `/split-pdf/` | 100 | 96 | 100 | 100 | 30.4 KB |
| transcribe | `/transcribe/` | 100 | 96 | 100 | 100 | 35.7 KB |
| video-compressor | `/video-compressor/` | 100 | 96 | 100 | 100 | 32.7 KB |
| webcam-test | `/webcam-test/` | 100 | 96 | 100 | 100 | 29.5 KB |

## Budget check: initial JS ≤ 60KB

Per the project's own performance budget, this counts only Script-type network requests captured during a normal (non-interacted) page load — i.e. the astro-island hydration runtime, the small tool Svelte component itself (client:visible), TrustMeter/CommandPalette, etc. It deliberately excludes the heavy engines (ffmpeg.wasm, onnxruntime-web, transformers.js, tesseract.js, pdf-lib) since those are dynamically `import()`-ed only inside click/action handlers and never appear in Lighthouse's cold-load network log unless the page eagerly bundles them.

**All 21 pages are within budget.** Highest is `file-drop` at 43KB (WebRTC signaling/pairing UI is bigger than a typical tool console but still well under 60KB).

### Fixed during this audit

Initially, **5 pages were over budget** — merge-pdf, pdf-compressor, redact, sign-pdf, split-pdf, each shipping ~200KB of initial JS (Performance scores 96-99). The cause: all 5 tool components did `import { PDFDocument } from 'pdf-lib'` as a static top-level import, so pdf-lib (~429KB raw / ~174KB gzipped, Rollup chunk named `PDFButton.js` after one of pdf-lib's own internal class names) got bundled into the eagerly-hydrated (`client:visible`) tool island instead of being deferred — unlike every other heavy dependency in this codebase (`ffmpegEngine.ts`, `onnxSetup.ts`, `pdf-shared/pdfjs.ts`, and even `jszip` inside these same files), which are all dynamically `import()`-ed inside their action handlers.

**Fix applied** (within the task's allowed scope, `src/tools/*/*.svelte`): converted the static `import { PDFDocument, ... } from 'pdf-lib'` in `MergePdf.svelte`, `SplitPdf.svelte`, `SignPdf.svelte`, `Redact.svelte`, and `PdfCompressor.svelte` to a dynamic `const { PDFDocument } = await import('pdf-lib')` inside each file's single async action handler (`merge()`, `run()`, `exportPdf()`, `flattenAndExport()`, `compressOne()`), matching the codebase's own established lazy-load convention. Re-ran Lighthouse after the fix: all 5 pages dropped to 29.8–31.7KB initial JS and Performance scores rose to 100 (split-pdf: 96→100).

## Pages below 90 in any category

**None.** After the fixes below, every page scores 96 or 100 in every category (100 across the board on the 5 static pages: home + 4 hubs).

## Accessibility findings from Lighthouse + axe-core (below 100)

All 16 tool pages score 96 on Accessibility (the 5 static pages — home + 4 hubs, no interactive islands — score 100). One Lighthouse audit and one axe-only audit were found; both are described together since they came from the same shared `Dropzone.svelte` primitive.

1. **`label` (missing accessible name)** — Lighthouse flagged the shared `Dropzone.svelte` primitive's hidden `<input type="file">` for having no `aria-label`, `aria-labelledby`, or wrapping `<label>`. Affected every tool page that uses a Dropzone (13 of 16 — all except mic-test, screen-recorder, webcam-test, which use device permission buttons instead).
   - **Fixed**: added `aria-label={label}` to the hidden input in `src/design/primitives/Dropzone.svelte`, reusing the same text already shown visibly as the dropzone's label prop.

2. **`nested-interactive` (serious, axe-core only — not in Lighthouse's default audit set)** — the same `Dropzone.svelte` wrapped its `role="button"` / `tabindex=0` outer `<div>` around the native `<input type="file">`, putting two interactive controls in the accessibility tree, one nested inside the other. Same 13 pages affected.
   - **Fixed**: replaced the `role="button"` div (with its manual `onclick`/`onkeydown` handlers) with a native `<label>` wrapping the input. A label's built-in behavior — click anywhere in it to activate the wrapped control, no-op when that control is `disabled` — replaces all of that manual JS, and the input itself was already keyboard-focusable/operable (visually-hidden, not `display:none`), so Tab/Enter/Space still work with no regression. Verified: dropzone still renders as a full-size block click target (`display:block` added, since `<label>` is inline by default) and the file input is still reachable via Tab.

3. **`color-contrast`** — the only violation remaining on all 16 tool pages. `TrustMeter.svelte`'s `.tm-key`, `.tm-engine`, and `.tm-note` text renders at a measured contrast ratio of **2.89:1** (foreground `#8a867b`, background `#eae5d9`, 12px/9pt), against the WCAG AA requirement of 4.5:1 for this text size. The color comes from the shared design token `--fg-faint` (→ `--color-ink-faint`) in `src/design/tokens.css`, used broadly across the design system for de-emphasized text (also `.dz-hint`, `.dz-icon` in Dropzone, etc.) — **not fixed here**: per this audit's own scope guidance, a token-level contrast fix is a real color-system redesign decision (it affects every "faint" text element site-wide, in both light/dark themes), left for the separate design-review pass to own holistically. Flagged here with exact numbers so that pass has what it needs.

See `qa/keyboard-audit.md` for a fourth accessibility finding — missing visible focus indicator on all `<input type="range">` sliders — caught by the keyboard-only pass (neither Lighthouse nor axe-core's default rule set checks for this), also fixed.

## Best Practices / SEO

Best Practices is 100 on every page except `file-drop` (96). Cause, confirmed from the raw report: `errors-in-console` — a WebSocket connection failure to `ws://localhost:8787/ws/filedrop/...`. This is an artifact of this shared dev checkout, not a site bug: a `.env.local` (left by another agent testing File Drop against a local `wrangler dev` signaling worker on port 8787) set `PUBLIC_SIGNALING_URL`, which Vite baked into this build; that local worker wasn't reachable from this audit's isolated preview server. A production build (no such `.env.local`) would not have this console error. SEO is 100 on all 21 pages.

## Raw reports

Full Lighthouse JSON for every page is at `qa/lighthouse/<slug>.json` (gitignored). Route → slug mapping is in `qa/routes.json`.

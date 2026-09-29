# Handoff — what a human needs to review before launch

This repo was built across two agentic sessions: an initial build session (§7
override: "build the complete system in one day"), followed by a full QA pass
with a real headless Chromium, real fake media devices, real engines, and a
real local Cloudflare Worker. **Sections 1-6 below are the original build
session's notes and are partly superseded** — see the Go/No-Go checklist
immediately below for the current, accurate state. Full detail on everything
tested: `QA-REPORT.md`.

## Go/No-Go checklist

### Verified by automated tests (real browser, real engines, no mocking)
- All 16 tools' core UI/workflow, using real fake camera/mic/screen-capture,
  real PDF processing, a real ffmpeg.wasm transcode, and a real two-device
  WebRTC file transfer (SHA-256 byte-exact match) via a real local signaling
  Worker (`wrangler dev`).
- Redact's core privacy claim: drawn-over text is genuinely unextractable
  from the output; untouched pages keep their text.
- Trust Meter: 0 bytes / no POST-PUT-PATCH requests on every tool, for the
  entire duration of every test.
- SEO: 345/346 scripted checks (titles, descriptions, canonical, OG, JSON-LD,
  sitemap, robots, full internal link graph, no-JS content).
- Performance: Lighthouse 100/100/100/100 on every page (mobile).
- Accessibility: 24/24 axe-core tests pass, 0 serious/critical violations,
  full keyboard audit done.
- Security headers (`public/_headers`) live-tested against real Chromium
  across all 21 pages, including working COOP/COEP on the three engine-heavy
  tool pages.
- Design: 150 reference screenshots (25 pages × 3 widths × 2 themes), no
  anti-brief violations, no 360px overflow anywhere.
- `npm run build`: 0 errors, 25/25 pages, as the final step of this pass.

### Fixed during this QA pass (real bugs, not just test issues)
- pdfjs-dist crashed on any browser without the brand-new
  `Map.prototype.getOrInsertComputed` (broke PDF Compressor/Split/Redact) —
  polyfilled.
- PDF Compressor could hand back a file larger than the input on low-detail
  sources — now falls back to the original bytes.
- Video Compressor and the two ONNX tools' engines were CDN-dependent
  (blocked by this sandbox's network policy) — now self-hosted, verified
  working with zero third-party requests.
- File Drop's sender-side progress UI never updated (Svelte 5 `$state`
  reactivity bug) — fixed; verified with a real transfer.
- ~200KB initial-JS budget violation on 5 PDF tools (static vs. lazy
  `pdf-lib` import) — fixed, all now load ~30KB.
- Two real axe-core violations (missing accessible name, nested-interactive)
  and two rounds of WCAG AA color-contrast failures (a shared faint-text
  token, then the brand vermilion used directly as text) — all fixed.
- Screen Recorder's idle toggle buttons had a CSS specificity bug making an
  "on" toggle's text invisible (signal-on-signal) — fixed.
- Three real bugs in the security-headers pass (invalid STUN CSP entry,
  missing `media-src`, COEP needing CORP on built assets) — fixed.
- Six page titles over the 60-char SEO budget — fixed.

### Still open (with severity)
- **Medium — real inference unverified.** Transcriber (Whisper), OCR
  (tesseract.js), Background Remover, and Image Upscaler: UI and
  error-handling are verified for real (a real network request fires, a real
  error surfaces gracefully within a timeout), but actual model
  download/inference has never run end-to-end, because this sandbox's
  network policy blocks huggingface.co/jsdelivr.net/unpkg.com outright. This
  is a sandbox limitation, not a known defect — but it is genuinely
  unverified. **Do one real-browser pass per tool with real internet access
  before calling these four launch-ready.**
- **Low — PWA first-visit offline.** A page's very first visit can't be
  cached by its own service-worker install; an offline reload of an
  only-once-visited page silently serves the cached homepage instead of an
  explicit offline notice. Documented, not fixed (a UX judgment call, see
  `public/sw.js`'s comments).
- **Low — Sign & Fill keyboard gap.** Placing a signature/text field is
  fully keyboard-operable; moving/resizing it afterward is pointer-only.
  Real feature work, not a safe small fix.
- **Low — 404 canonical mismatch.** Inherent Astro static-build quirk for
  the special 404 route; not linked or sitemapped, so no real SEO impact.
- **Info — decorative signal-color use.** The vermilion accent is used
  decoratively (not just for live/active states) as the catalogue's serial-
  number/wayfinding signature (header mark, "No. XX" labels). Flagged by the
  anti-brief's letter but applied with total restraint; left as a judgment
  call for the brief owner rather than changed unilaterally.
- **Part 2 (launch assets) was not started this session** — demo media,
  marketing screenshots, Product Hunt/Show HN/Reddit copy, directory
  listings, README polish, and social posts are all still to do.

### Owner-only tasks (can't be done from this sandbox)
- Real-device testing: iPhone Safari, Android Chrome, Firefox.
- Two-device File Drop transfer over a real network (only same-machine
  loopback WebRTC was tested here; STUN itself was confirmed unreachable
  from this sandbox, so cross-network NAT traversal is unverified).
- Content review: every tool's copy is still `draftContent: true` — needs
  real keyword research (PRD §5) before publishing; flip the flag once
  reviewed.
- Cloudflare Pages deploy + the separate `workers/filedrop` Worker deploy +
  `PUBLIC_SIGNALING_URL` at build time.
- Domain pointing, Search Console + Bing verification, first IndexNow ping
  (only possible once the domain is live — see `docs/indexnow.md`).
- Posting/publishing any launch assets once Part 2 is produced.

## Post-QA: first real Cloudflare deploy attempt — failed, fixed

The first real Cloudflare deploy failed: `✘ [ERROR] Asset too large` —
`dist/_astro/ffmpeg-core.wasm` was 30.6 MiB, over Cloudflare's 25 MiB
per-asset limit (applies to both Pages and Workers static-asset deploys).
Root cause: the self-hosting fix for ffmpeg.wasm/onnxruntime-web made during
the QA pass (item above, "CDN-dependent … now self-hosted") traded a
sandbox-only network-policy block for a real production deploy blocker,
since these engines' WASM files are tens of MB. Fixed:

- `src/tools/video-compressor/ffmpegEngine.ts`: loads `@ffmpeg/core` from
  jsdelivr via `toBlobURL()` (ffmpeg.wasm's documented CORS-safe pattern)
  instead of a bundled `?url` import.
- `src/tools/remove-background/onnxSetup.ts` and
  `src/tools/image-upscaler/onnxSetup.ts`: point `ort.env.wasm.wasmPaths` at
  jsdelivr instead of bundled `?url` imports.
- `astro.config.mjs`: added `vite.resolve.conditions:
  ['onnxruntime-web-use-extern-wasm']` — without this, Vite still statically
  bundled all ~26-28MB WASM variants from onnxruntime-web's default entry
  (`new URL(..., import.meta.url)` references baked into `ort.bundle.min.mjs`)
  even though the runtime `wasmPaths` override made those bundled copies
  unused dead weight. This resolves the "`dist/` bloat from onnxruntime-web"
  item in §6 below — it was a real deploy blocker, not just bloat.
- `public/_headers`: added `cdn.jsdelivr.net` to CSP script-src/worker-src/
  connect-src (and `blob:` to script-src) for `/video-compressor/*`,
  `/remove-background/*`, `/image-upscaler/*`.

Verified locally: `npm run build` (0 errors, 25/25 pages), `dist/` total
7.2MB (was 130MB+), zero files over 25 MiB. **Not re-verified live** —
jsdelivr is blocked in this sandbox's network policy, same limitation noted
throughout `QA-REPORT.md`. On the next real deploy, confirm: Video
Compressor/Background Remover/Image Upscaler still load and process a real
file with zero blocked requests, and `self.crossOriginIsolated === true` on
`/video-compressor`.

Separately, the same build log showed the Cloudflare project running
`npx wrangler deploy`, which auto-detected Astro and ran `astro add
cloudflare` — mutating `astro.config.mjs` to add the `@astrojs/cloudflare`
server adapter and rebuilding in `server` mode. That's a Cloudflare
dashboard/build-command configuration mismatch, not a codebase issue: this
project is a static site (`output: 'static'`); the Cloudflare Pages project
should build with `npm run build` and deploy `dist/` as static assets, not
run `wrangler deploy`.

---

## Original build-session notes (partly superseded — see checklist above)

A few categories below say "not verified" because the original build session
had no live browser. That has since changed — see `QA-REPORT.md` for what a
real headless Chromium pass actually confirmed. Sections are kept for
historical detail on decisions made (e.g. license checks, architecture notes).

## 1. SEO content — DRAFT, needs human review

Every tool page's copy (`src/content/tools/*.md` — `oneLine`, the intro
paragraph, `steps`, `tips`, `faq`) is written to be specific and useful per
the PRD's content rule (no mass-generated filler), and every file is marked
`draftContent: true` in its frontmatter. It has **not** been checked against
real keyword research (Search Console / a keyword tool, PRD §5) or against
the current top-5 ranking pages for each target keyword. Before publishing:

- Run the PRD's keyword process (§5) per tool: primary keyword + 3–5
  variants, review the current top 5 results, confirm the page beats them on
  usefulness.
- Spot-check every factual claim against the finished tool (e.g. the PDF
  Compressor copy was rewritten mid-session to match its actual rasterize-
  each-page implementation — a good example of the kind of drift to check
  for elsewhere).
- Once reviewed, flip `draftContent: false` in each file's frontmatter as a
  simple "reviewed" marker (nothing reads that field at runtime yet, but the
  README's "Adding a tool" section and this file both point at it as the
  convention).

## 2. Licenses — see `LICENSES.md`, two models need a final check

`LICENSES.md` has the full table. Flagged specifically:

- **Background Remover** uses `Xenova/modnet` (Apache-2.0). `briaai/RMBG-1.4`
  was correctly rejected as non-commercial-only — good, but re-confirm the
  Apache-2.0 grant directly on the model card before launch, since it was
  checked by an agent via search rather than a maintained legal process.
- **Image Upscaler** uses `Xenova/swin2SR-classical-sr-x2-64` /
  `-x4-64` (Apache-2.0, ported from `caidas/swin2SR-*` / `mv-lab/swin2sr`).
  Same re-confirmation ask.
- **jszip** is dual-licensed MIT/GPL-3.0 — this project uses it under the
  MIT term, which is fine, but don't let a future contributor add
  GPL-only jszip plugins/forks without re-checking that stays true.

## 3. Not verified live in this session (no browser, no device, no CDN account)

Every tool below **builds and typechecks correctly** and its agent verified
the code against the real installed library APIs (reading `.d.ts` files, not
just memory) — but none of these were exercised end-to-end in an actual
browser:

- **Screen Recorder** — real `getDisplayMedia` picker flow, real audio
  mixing (screen audio + mic), real webcam-bubble compositing, playability
  of the exported .webm.
- **Video Compressor** — an actual ffmpeg.wasm transcode (CDN core fetch,
  wasm exec, progress events, GIF export quality — currently a simple
  `fps=10` filter with no two-pass palette generation, a known quality
  tradeoff for gradients).
- **Transcriber** — real Whisper model download + inference (WebGPU path
  and the WASM fallback both need a spot-check), and video-container audio
  decoding across formats beyond the common ones.
- **OCR** — a real Tesseract.js recognition pass, including its own runtime
  CDN fetches for the core/language data, for all four configured languages
  (eng/mal/hin/tam).
- **Background Remover / Image Upscaler** — actual ONNX inference: model
  download, the assumed tensor input/output names and shapes (resolved at
  runtime via `session.inputNames[0]`/`outputNames[0]` rather than
  hardcoded, specifically because they couldn't be confirmed live), WebGPU
  vs WASM execution, and real output image quality.
- **File Drop** — the entire two-device pairing + WebRTC transfer flow.
  The Worker code, wrangler config, and client are all written and typed
  correctly, but nothing here has spoken to a live Cloudflare account.
- **Service worker (`public/sw.js`)** — install/activate/fetch logic is
  correct Cache API usage, but actual offline behavior (airplane-mode
  reload, cache eviction, update flow) needs a real browser pass.

**Recommendation:** before soft launch, do one real-browser pass per tool
with a real input file/device, per the PRD's own "Definition of done" bar
(§ build instructions this session followed): works end-to-end in Chrome,
Lighthouse ≥ 90 on Performance/Accessibility/SEO/Best Practices.

## 4. Device/browser testing — not done

Nothing in this session was tested on Safari (macOS/iOS), Firefox, or a
low-end Android device — there was no such environment available. Known
risk areas going in, per the PRD's own callouts: `getDisplayMedia` (Screen
Recorder) has partial/inconsistent Safari support; `SharedArrayBuffer`-
dependent code was deliberately avoided (ffmpeg.wasm uses the single-thread
core, ONNX Runtime Web's threaded WASM build isn't required since it falls
back automatically) specifically so nothing here *requires* COOP/COEP
headers — but that also means none of it benefits from the speed of
multi-threaded WASM yet. See §6.

## 5. Deployment — steps an owner still needs to do

Nothing is deployed. To ship:

1. **Cloudflare Pages**: connect this repo, build command `npm run build`,
   output directory `dist`. No environment variables are required for a
   basic deploy; set `PUBLIC_SIGNALING_URL` (see next point) once File Drop
   has a signaling server to point at.
2. **File Drop's signaling Worker** (`workers/filedrop/`): a completely
   separate deploy — see `workers/filedrop/README.md` for the full
   `wrangler login` / `wrangler deploy` steps. Until this is deployed and
   `PUBLIC_SIGNALING_URL` is set at Pages build time, `/file-drop` will not
   be able to pair two devices.
3. **Domain**: point `tools.nabl.in` at the Cloudflare Pages project;
   `astro.config.mjs`'s `site` and the JSON-LD/canonical URLs throughout
   already assume this exact domain — update them first if it changes.
4. **Search Console + Bing Webmaster Tools**: verify the domain, submit
   `https://tools.nabl.in/sitemap-index.xml` (already generated by
   `@astrojs/sitemap` on every build). IndexNow pings for Bing (PRD §5) are
   **not implemented** — that needs an IndexNow API key and a small script
   (or Cloudflare Pages build hook) added once the domain is live; not done
   here since there's nothing to ping yet.
5. **Real favicon/OG source art**: `public/favicon.svg` and the generated
   icon/OG set (`scripts/gen-icons.mjs`, `scripts/gen-og.mjs`) currently use
   a placeholder geometric mark, not a designed brand mark — swap the SVG
   source and re-run `npm run build` once real brand art exists.

## 6. Optional follow-ups (not required to launch)

- **COOP/COEP headers.** Not configured. Nothing currently requires them
  (ffmpeg.wasm runs its single-thread core; onnxruntime-web falls back to
  non-threaded WASM without cross-origin isolation) — but adding a Cloudflare
  Pages `public/_headers` file scoping `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` to `/video-compressor/*`,
  `/remove-background/*`, and `/image-upscaler/*` would unlock the faster
  multi-threaded WASM path on those three pages. Needs a real deploy to
  verify the CDN-hosted engine files (jsdelivr/unpkg) send a compatible
  `Cross-Origin-Resource-Policy` header before enabling — untested here.
- **`dist/` bloat from onnxruntime-web.** The build statically bundles
  onnxruntime-web's ~26–28MB WASM backend files into `dist/_astro/` even
  though both ONNX tools override `ort.env.wasm.wasmPaths` to a CDN at
  runtime (so those bundled files are never actually served/fetched). This
  doesn't affect functionality but inflates the deploy artifact; fixing it
  needs a Vite/Rollup exclusion for `onnxruntime-web`'s wasm assets, which
  wasn't attempted here to avoid risking the build without a way to verify
  the fix live.
- **Per-engine offline caching.** `public/sw.js` deliberately leaves
  cross-origin requests (ffmpeg core, ONNX models, Whisper weights,
  Tesseract language data) untouched — see the comment at the bottom of
  that file. Real "loads a 40MB engine once, then works offline" behavior
  needs each tool to explicitly `cache.put()` its own engine files; not
  implemented for any tool yet.
- **IndexNow** — see §5.
- **File Drop TURN relay** — see `workers/filedrop/README.md`; only public
  STUN is configured, so two devices behind symmetric NATs may fail to
  connect without a TURN fallback.
- **Merge PDF: whole-file reorder only.** The original PRD content draft
  implied per-page drag reordering during a merge; the shipped tool reorders
  whole source files (drag or up/down buttons) rather than individual pages,
  and the content copy (`src/content/tools/merge-pdf.md`) was corrected to
  match mid-session. Per-page reordering during merge is a real feature gap
  versus the first content draft, not a bug — flagged here in case it's
  wanted later.

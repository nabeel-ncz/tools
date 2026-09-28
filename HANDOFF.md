# Handoff — what a human needs to review before launch

This repo was built in one agentic session per an accelerated version of the
PRD's timeline (§7 override: "build the complete system in one day," keeping
the PRD's build order). Everything below is real, working code that passes
`npm run build` (icon/OG generation → `astro check` → `astro build`) — but a
few categories of work are explicitly **not** verified the way a human
QA pass would verify them, because this session had no live browser, no
Cloudflare account, and no way to actually speak WebRTC to a second device.
Read this before calling anything here launch-ready.

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

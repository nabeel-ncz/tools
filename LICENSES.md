# Third-party licenses

This project is built on open-source libraries and, for a few tools, pre-trained
ML models fetched from the browser at runtime (never bundled, never uploaded to
us). Every one below is permissively licensed for commercial use. If you add a
new library or model, add a row here first — per the PRD, license review happens
**before** building the tool, not after.

## Libraries (npm)

| Package | License | Used by |
|---|---|---|
| astro | MIT | Framework |
| svelte / @astrojs/svelte | MIT | Tool islands |
| @astrojs/sitemap | MIT | Sitemap generation |
| pdf-lib | MIT | PDF Compressor, Merge, Split, Sign & Fill, Redact |
| pdfjs-dist | Apache-2.0 | PDF Workbench, Sign & Fill, Redact, OCR (PDF input) |
| @ffmpeg/ffmpeg, @ffmpeg/util | MIT | Video Trimmer & Compressor |
| onnxruntime-web | MIT | Background Remover, Image Upscaler |
| @huggingface/transformers | Apache-2.0 | Audio/Video Transcriber (Whisper) |
| tesseract.js | Apache-2.0 | OCR |
| qrcode | MIT | File Drop pairing QR code |
| jszip | MIT **or** GPL-3.0-or-later (dual-licensed) | Favicon Generator, PDF Workbench batch export, Background Remover batch export — used under the MIT term |
| sharp | Apache-2.0 | Build-time icon/OG image generation (not shipped to the browser) |

## Fonts (self-hosted via Fontsource, not a runtime CDN)

| Font | License |
|---|---|
| Fraunces | OFL-1.1 |
| IBM Plex Sans | OFL-1.1 |
| JetBrains Mono | OFL-1.1 (Apache-2.0 for the JetBrains Mono Regular hinting/tooling) |

## ML models (fetched by the browser on first use, cached, never bundled)

| Model | License | Used by | Notes |
|---|---|---|---|
| `onnx-community/whisper-tiny`, `onnx-community/whisper-base` | MIT (OpenAI Whisper) | Transcriber | Multilingual ASR, ONNX export for `@huggingface/transformers` |
| `Xenova/modnet` (ONNX export of ZHKKKe/MODNet) | Apache-2.0 | Background Remover | `briaai/RMBG-1.4` was considered first and **rejected** — its license (BRIA custom, non-commercial without a paid agreement) doesn't clear this project's "commercial use allowed" bar |
| `Xenova/swin2SR-classical-sr-x2-64`, `Xenova/swin2SR-classical-sr-x4-64` (ONNX exports of `caidas/swin2SR-classical-sr-{x2,x4}-64`, ported from `mv-lab/swin2sr`) | Apache-2.0 | Image Upscaler | Native x4 checkpoint used for the 4× option rather than running the 2× model twice |
| Tesseract language data (eng, mal, hin, tam, …) | Apache-2.0 | OCR | Fetched by tesseract.js from its own CDN on first use per language |

**Flagged for human re-verification before launch:** the two ONNX model choices
above (MODNet, Swin2SR) were selected and license-checked by an agent from each
model's Hugging Face card, but **not exercised in a live browser** in this build
session (no such environment was available). Confirm the license terms once
more directly on the model cards, and do one real inference run of each, before
relying on this table for a launch decision. See `HANDOFF.md`.

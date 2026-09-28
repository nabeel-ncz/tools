# NABL Tools

Private, instant tools that run in your browser. No login, no uploads, no distractions.

**Positioning:** Nothing leaves your device.

See [`docs/tools-nabl-prd.md`](./HANDOFF.md) for the product brief this repo implements, and [`HANDOFF.md`](./HANDOFF.md) for what still needs human review before launch.

## Stack

- [Astro](https://astro.build) (static output) + [Svelte 5](https://svelte.dev) islands for interactive tools
- CSS custom properties design system ("The Instrument Bench") — no UI kit
- Content collections for per-tool SEO copy (`src/content/tools/*.md`)
- Heavy engines (ffmpeg.wasm, ONNX Runtime Web, Whisper via `@huggingface/transformers`, Tesseract.js) lazy-loaded on interaction, not on page load
- Cloudflare Pages (static hosting) + a Cloudflare Worker/Durable Object (`workers/filedrop/`) for File Drop's peer-pairing signaling only — no file bytes ever pass through it

## Repo structure

```
src/
  design/          tokens, fonts, primitives (Dial, SteppedSlider, Meter, Dropzone, TrustMeter, Led, CommandPalette)
  tools/<slug>/     one folder per tool: its Svelte island + any engine-loading helpers
  content/tools/    one .md per tool (SEO content + frontmatter: steps, specs, FAQ, related)
  layouts/          BaseLayout (site chrome, SEO meta, JSON-LD) + ToolLayout (per-tool page template)
  pages/            routes: homepage index, /video /pdf /image /devices hubs, one file per tool
workers/filedrop/   Cloudflare Worker + Durable Object signaling server for File Drop
scripts/            build-time icon + OG image generation (sharp)
```

## Getting started

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # runs scripts/gen-icons.mjs + scripts/gen-og.mjs, then astro check + astro build
npm run preview
```

## Adding a tool

1. Write its SEO content first: `src/content/tools/<slug>.md` (see any existing file for the schema — `src/content/config.ts`).
2. Build the interactive island: `src/tools/<slug>/<Name>.svelte`, reusing `src/design/primitives/*`.
3. Wire the page: `src/pages/<slug>.astro` — `getEntry('tools', '<slug>')` then `<ToolLayout tool={tool}><YourIsland slot="tool" client:visible /></ToolLayout>`.
4. Run `npm run build` — it regenerates that tool's OG image automatically from its frontmatter.

## Design principles (non-negotiable)

1. **Local-first.** Processing happens in the browser. The only exception is File Drop's signaling (no file data).
2. **Instant.** Usable on page load; heavy engines load on first interaction with visible progress.
3. **Zero friction.** No login, ads, popups, or cross-promotion.
4. **Every tool is a page.** Own URL, own SEO, own content.
5. **Trust is visible.** The Trust Meter (`src/design/primitives/TrustMeter.svelte`) on every tool page proves nothing was uploaded.

Anti-brief: no gradients, glassmorphism, glowing blobs, identical card grids, emoji icons, or generic "Supercharge your workflow" copy.

## Deployment

Not yet deployed — see [`HANDOFF.md`](./HANDOFF.md) for the exact steps (Cloudflare Pages project, the File Drop Worker, DNS, Search Console/Bing verification).

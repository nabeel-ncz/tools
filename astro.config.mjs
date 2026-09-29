import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://tools.nabl.in',
  output: 'static',
  integrations: [svelte(), sitemap()],
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    resolve: {
      // onnxruntime-web's default entry (ort.bundle.min.mjs) contains
      // `new URL('ort-wasm-*.wasm', import.meta.url)` references for every
      // WASM variant (threaded, jsep, asyncify — up to ~28MB each), which
      // Vite's static asset analysis bundles into dist regardless of the
      // runtime `env.wasm.wasmPaths` override in onnxSetup.ts, blowing past
      // Cloudflare's 25 MiB per-asset deploy limit. This condition picks
      // onnxruntime-web's "extern-wasm" entry (ort.min.mjs) instead, which
      // has no such references and relies entirely on wasmPaths at runtime
      // — see src/tools/remove-background/onnxSetup.ts and
      // src/tools/image-upscaler/onnxSetup.ts.
      conditions: ['onnxruntime-web-use-extern-wasm'],
    },
  },
});

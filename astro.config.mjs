import { fileURLToPath } from 'node:url';
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
      alias: [
        {
          // onnxruntime-web's default entry (ort.bundle.min.mjs) contains
          // `new URL('ort-wasm-*.wasm', import.meta.url)` references for
          // every WASM variant (threaded, jsep, asyncify — up to ~28MB
          // each), which Vite's static asset analysis bundles into dist
          // regardless of the runtime `env.wasm.wasmPaths` override in
          // onnxSetup.ts, blowing past Cloudflare's 25 MiB per-asset deploy
          // limit. This alias points straight at onnxruntime-web's
          // "extern-wasm" entry (ort.min.mjs) instead, which has no such
          // references and relies entirely on wasmPaths at runtime — see
          // src/tools/remove-background/onnxSetup.ts and
          // src/tools/image-upscaler/onnxSetup.ts.
          //
          // Uses a regex `find` anchored to the exact specifier, and a
          // direct filesystem path rather than `vite.resolve.conditions`,
          // for two reasons: a plain string key here would prefix-match and
          // also rewrite deep imports like 'onnxruntime-web/webgpu' (used
          // internally by @huggingface/transformers for the Transcriber
          // tool); and `resolve.conditions` replaces Vite's default client
          // conditions ('browser'/'import'/etc.) rather than adding to
          // them, which made every other package's conditional `exports`
          // map fall through to its `"default"` branch — including
          // Svelte's, whose default is its *server* runtime, which broke
          // hydration (and therefore nearly every tool) on every page.
          find: /^onnxruntime-web$/,
          replacement: fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.min.mjs', import.meta.url)),
        },
        {
          // Same problem, separate entry point: @huggingface/transformers
          // (used by the Transcriber tool) imports 'onnxruntime-web/webgpu'
          // directly, which resolves to its own nested onnxruntime-web
          // copy's *bundled* webgpu variant — pulling in another ~26MB
          // `new URL(..., import.meta.url)` wasm reference independent of
          // the alias above. Redirect it to the top-level package's
          // extern-wasm webgpu entry, which has no such references.
          find: /^onnxruntime-web\/webgpu$/,
          replacement: fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs', import.meta.url)),
        },
      ],
    },
  },
});

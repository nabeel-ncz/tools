// Small, self-contained onnxruntime-web bootstrap for this tool.
// Duplicated (not shared) in src/tools/image-upscaler/onnxSetup.ts by design, per the
// project's rule that these two tool folders stay self-contained.
//
// onnxruntime-web is dynamically imported so its (fairly large) JS glue code isn't part
// of the initial page bundle for every visitor — only people who actually start
// processing pay for it.
//
// The WASM backend files are self-hosted (via Vite's `?url` asset import) from the
// onnxruntime-web npm package rather than fetched from a CDN at runtime — no
// third-party dependency, works with the service worker's same-origin caching, and
// the files Vite already has to bundle (see the dist-size note in HANDOFF.md) are
// actually the ones served, instead of sitting in dist/ unused.

import type * as OrtNamespace from 'onnxruntime-web';

import wasmThreaded from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import mjsThreaded from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import wasmJsep from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import mjsJsep from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';
import wasmAsyncify from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import mjsAsyncify from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

const WASM_PATHS: Record<string, string> = {
  'ort-wasm-simd-threaded.wasm': wasmThreaded,
  'ort-wasm-simd-threaded.mjs': mjsThreaded,
  'ort-wasm-simd-threaded.jsep.wasm': wasmJsep,
  'ort-wasm-simd-threaded.jsep.mjs': mjsJsep,
  'ort-wasm-simd-threaded.asyncify.wasm': wasmAsyncify,
  'ort-wasm-simd-threaded.asyncify.mjs': mjsAsyncify,
};

let ortPromise: Promise<typeof OrtNamespace> | null = null;

/** Dynamically imports onnxruntime-web and points it at the self-hosted WASM/WebGPU backend files. */
export function loadOrt(): Promise<typeof OrtNamespace> {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web').then((ort) => {
      ort.env.wasm.wasmPaths = WASM_PATHS;
      return ort;
    });
  }
  return ortPromise;
}

/** Fetches a model file with byte-level download progress, since InferenceSession.create() itself reports none. */
export async function fetchWithProgress(url: string, onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Could not download the model (HTTP ${res.status}).`);
  }
  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total || loaded);
    }
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

/** Creates a session, preferring WebGPU and transparently falling back to the WASM backend. */
export async function createSession(
  ort: typeof OrtNamespace,
  modelBytes: ArrayBuffer,
): Promise<{ session: Awaited<ReturnType<typeof OrtNamespace.InferenceSession.create>>; backend: 'webgpu' | 'wasm' }> {
  try {
    const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['webgpu'] });
    return { session, backend: 'webgpu' };
  } catch {
    const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
    return { session, backend: 'wasm' };
  }
}

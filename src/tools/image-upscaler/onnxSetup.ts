// Small, self-contained onnxruntime-web bootstrap for this tool.
// Duplicated (not shared) in src/tools/image-upscaler/onnxSetup.ts by design, per the
// project's rule that these two tool folders stay self-contained.
//
// onnxruntime-web is dynamically imported so its (fairly large) JS glue code isn't part
// of the initial page bundle for every visitor — only people who actually start
// processing pay for it.

import type * as OrtNamespace from 'onnxruntime-web';

const ORT_VERSION = '1.30.0';

let ortPromise: Promise<typeof OrtNamespace> | null = null;

/** Dynamically imports onnxruntime-web and points it at the matching CDN build of its WASM/WebGPU backend files. */
export function loadOrt(): Promise<typeof OrtNamespace> {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web').then((ort) => {
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
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

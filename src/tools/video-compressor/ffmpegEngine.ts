// Lazy loader for ffmpeg.wasm (single-threaded core).
//
// NOTE: this module dynamically imports `@ffmpeg/ffmpeg` and fetches the
// core/wasm binaries from a CDN the first time a compression job is started.
// It is code-correct against the documented @ffmpeg/ffmpeg v0.12 API, but
// this environment has no way to actually drive a browser and run a real
// ffmpeg.wasm transcode, so the end-to-end export path (load -> writeFile ->
// exec -> readFile) has not been exercised live. It has been checked against
// the ffmpeg.wasm docs and the installed package's type declarations.
//
// We intentionally use the single-thread core (@ffmpeg/core, NOT
// @ffmpeg/core-mt): the multi-threaded core requires cross-origin isolation
// (COOP/COEP headers) to use SharedArrayBuffer, which this static site does
// not send. The single-thread core works from a plain CDN fetch with no
// special headers.

import type { FFmpeg } from '@ffmpeg/ffmpeg';

const CORE_VERSION = '0.12.6';
const BASE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

export interface EngineLoadHandle {
  ffmpeg: FFmpeg;
}

/**
 * Loads (or returns the already-loaded) ffmpeg.wasm instance.
 * `onProgress` receives ffmpeg's own exec progress (0..1) once a job starts;
 * it does not report the initial download progress (the browser doesn't
 * expose per-byte progress for toBlobURL fetches), so callers should show an
 * indeterminate progress state until this resolves.
 */
export async function loadEngine(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');

    const ffmpeg = new FFmpeg();

    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
      toBlobURL(`${BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
    ]);

    await ffmpeg.load({ coreURL, wasmURL });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    // Allow a retry on the next call if loading failed (e.g. offline / CDN blocked).
    loadingPromise = null;
    throw err;
  }
}

export function isEngineLoaded(): boolean {
  return ffmpegInstance !== null;
}

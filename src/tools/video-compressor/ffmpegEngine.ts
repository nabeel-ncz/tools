// Lazy loader for ffmpeg.wasm (single-threaded core), self-hosted from the
// @ffmpeg/core npm package rather than fetched from a CDN at runtime.
//
// Self-hosting (via Vite's `?url` asset import, same pattern as
// src/tools/pdf-shared/pdfjs.ts's worker import) means: no third-party CDN
// dependency for a core engine file, same-origin loading needs no
// toBlobURL() CORS workaround, and it works with the service worker's
// same-origin caching. The files are pulled from node_modules at build time
// and content-hashed into dist/_astro/ like any other bundled asset — they
// are not committed to the repo.
//
// We intentionally use the single-thread core (@ffmpeg/core, NOT
// @ffmpeg/core-mt): the multi-threaded core requires cross-origin isolation
// (COOP/COEP headers) to use SharedArrayBuffer, which this static site does
// not send. The single-thread core works with no special headers.

import type { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

export interface EngineLoadHandle {
  ffmpeg: FFmpeg;
}

/**
 * Loads (or returns the already-loaded) ffmpeg.wasm instance.
 * `onProgress` receives ffmpeg's own exec progress (0..1) once a job starts;
 * it does not report the initial download progress (the browser doesn't
 * expose per-byte progress for a plain URL load), so callers should show an
 * indeterminate progress state until this resolves.
 */
export async function loadEngine(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    // Allow a retry on the next call if loading failed.
    loadingPromise = null;
    throw err;
  }
}

export function isEngineLoaded(): boolean {
  return ffmpegInstance !== null;
}

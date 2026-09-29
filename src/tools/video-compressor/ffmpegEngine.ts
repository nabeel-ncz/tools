// Lazy loader for ffmpeg.wasm (single-threaded core), loaded from the
// jsDelivr CDN at runtime rather than bundled into our own static assets.
//
// The core's .wasm file is ~30MB, which exceeds Cloudflare's 25 MiB
// per-asset limit for static deploys (Pages and Workers assets alike) — a
// bundled copy makes the site fail to deploy outright. Loading from a CDN
// keeps it out of dist/_astro/ entirely. We still use toBlobURL() (from
// @ffmpeg/util) to fetch-then-blob it same-origin, which is ffmpeg.wasm's
// documented pattern for cross-origin core loading and keeps it working
// under this site's COEP/CORP headers.
//
// We intentionally use the single-thread core (@ffmpeg/core, NOT
// @ffmpeg/core-mt): the multi-threaded core requires cross-origin isolation
// (COOP/COEP headers) to use SharedArrayBuffer, which this static site does
// not send. The single-thread core works with no special headers.

import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

const CORE_VERSION = '0.12.6';
const CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

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
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    ]);
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

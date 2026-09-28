// Pre/post-processing for the segmentation model, kept separate from the Svelte
// component so the tensor math is easy to read and unit-test in isolation.
//
// Model: Xenova/modnet — an ONNX export (Apache-2.0) of ZHKKKe/MODNet, a portrait/
// general matting network. Verified via the model's Hugging Face card: license is
// Apache-2.0 (see final report for the license check on the alternative considered,
// briaai/RMBG-1.4, which is non-commercial and was rejected for that reason).
//
// ASSUMED INPUT/OUTPUT CONTRACT (not verified against a live browser session — see
// caveats in the final report):
//   Input  "pixel_values" (resolved at runtime via session.inputNames[0] rather than
//           hardcoded, since the exact IO name of this export couldn't be confirmed
//           live): float32, NCHW, 1x3xHxW, RGB channel order, normalized to [-1, 1]
//           via (x/255 - 0.5) / 0.5 — the official MODNet normalization.
//   Output (session.outputNames[0]): float32 alpha matte, 1x1xHxW, values in [0, 1],
//           same spatial size as the input (the network is fully convolutional).
//
// Sizing follows MODNet's own reference inference recipe (see the official repo's
// demo.py): resize so the longer side is 512px, then round both dimensions down to
// the nearest multiple of 32 (the network's stride), run inference at that size, and
// upsample the resulting matte back to the source resolution.

export interface ModnetInputSize {
  width: number;
  height: number;
}

const REF_SIZE = 512;
const STRIDE = 32;

/** Reproduces MODNet's reference-size + stride-rounding logic for a given source image size. */
export function computeModnetInputSize(srcWidth: number, srcHeight: number): ModnetInputSize {
  let w = srcWidth;
  let h = srcHeight;

  if (Math.max(w, h) < REF_SIZE || Math.min(w, h) > REF_SIZE) {
    if (w >= h) {
      h = REF_SIZE;
      w = Math.round((srcWidth / srcHeight) * REF_SIZE);
    } else {
      w = REF_SIZE;
      h = Math.round((srcHeight / srcWidth) * REF_SIZE);
    }
  }

  w = w - (w % STRIDE);
  h = h - (h % STRIDE);

  return { width: Math.max(STRIDE, w), height: Math.max(STRIDE, h) };
}

/** Reads pixels from a canvas already drawn at (w, h) and returns a normalized NCHW float32 tensor. */
export function canvasToModnetTensor(ctx: CanvasRenderingContext2D, w: number, h: number): Float32Array {
  const { data } = ctx.getImageData(0, 0, w, h);
  const plane = w * h;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    out[i] = (r - 0.5) / 0.5;
    out[plane + i] = (g - 0.5) / 0.5;
    out[plane * 2 + i] = (b - 0.5) / 0.5;
  }
  return out;
}

/**
 * Builds a small canvas whose ALPHA channel (not color) encodes the matte value at each
 * pixel, then lets the browser's own bilinear image scaling upsample that to the target
 * (full source) resolution — this avoids hand-rolling a resize filter for the mask.
 */
export function matteToAlphaCanvas(matteData: Float32Array, matteW: number, matteH: number, targetW: number, targetH: number): HTMLCanvasElement {
  const small = document.createElement('canvas');
  small.width = matteW;
  small.height = matteH;
  const sctx = small.getContext('2d')!;
  const imgData = sctx.createImageData(matteW, matteH);
  for (let i = 0; i < matteData.length; i++) {
    const a = Math.max(0, Math.min(255, Math.round(matteData[i] * 255)));
    imgData.data[i * 4] = 255;
    imgData.data[i * 4 + 1] = 255;
    imgData.data[i * 4 + 2] = 255;
    imgData.data[i * 4 + 3] = a;
  }
  sctx.putImageData(imgData, 0, 0);

  const full = document.createElement('canvas');
  full.width = targetW;
  full.height = targetH;
  const fctx = full.getContext('2d')!;
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = 'high';
  fctx.drawImage(small, 0, 0, targetW, targetH);
  return full;
}

/**
 * Composites the ORIGINAL full-resolution image against the upscaled matte using
 * destination-in, so the result canvas holds the original colors with the matte as
 * its alpha channel (transparent background, full-resolution subject).
 */
export function compositeWithMatte(source: CanvasImageSource, alphaCanvas: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(source, 0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(alphaCanvas, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

// Pre/post-processing for the super-resolution model, kept separate from the Svelte
// component so the tensor math is easy to read in isolation.
//
// Models: Xenova/swin2SR-classical-sr-x2-64 and Xenova/swin2SR-classical-sr-x4-64 —
// ONNX exports (Apache-2.0) of caidas/swin2SR-classical-sr-{x2,x4}-64, itself ported
// from mv-lab/swin2sr (Apache-2.0). Using the native x4 checkpoint for the 4x option
// instead of running the x2 model twice, since both scales are published as separate,
// permissively-licensed checkpoints.
//
// ASSUMED INPUT/OUTPUT CONTRACT (not verified against a live browser session — see
// caveats in the final report):
//   Input  (resolved at runtime via session.inputNames[0], not a hardcoded name):
//           float32, NCHW, 1x3xHxW, RGB channel order, rescaled to [0, 1] by dividing
//           by 255 — Swin2SR's HF image processor rescales but does not apply
//           mean/std normalization for this pixel-level restoration task.
//   Output (session.outputNames[0]): float32 reconstruction, NCHW, 1x3x(H*scale)x(W*scale),
//           values nominally in [0, 1] (clamped defensively on read-back, since the
//           network can overshoot slightly at bright edges).
//
// Swin2SR's traced forward pass pads H/W internally to a multiple of its window size
// and crops the output back down, so — per the model card — arbitrary input sizes are
// supported without extra padding logic on our side. To keep memory/compute bounded
// without implementing true tiling, very large sources are downscaled to fit within
// MAX_INPUT_DIM before upscaling; see the final report for why whole-image processing
// (with this cap) was chosen over tiling for v1.

export const MAX_INPUT_DIM = 1024;

/** Reads pixels from a canvas already drawn at (w, h) and returns a [0,1]-scaled NCHW float32 tensor. */
export function canvasToPixelTensor(ctx: CanvasRenderingContext2D, w: number, h: number): Float32Array {
  const { data } = ctx.getImageData(0, 0, w, h);
  const plane = w * h;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = data[i * 4] / 255;
    out[plane + i] = data[i * 4 + 1] / 255;
    out[plane * 2 + i] = data[i * 4 + 2] / 255;
  }
  return out;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** Converts an NCHW float32 [0,1] reconstruction tensor back into a drawable canvas. */
export function pixelTensorToCanvas(tensorData: Float32Array, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(w, h);
  const plane = w * h;
  for (let i = 0; i < plane; i++) {
    imgData.data[i * 4] = clamp255(tensorData[i]);
    imgData.data[i * 4 + 1] = clamp255(tensorData[plane + i]);
    imgData.data[i * 4 + 2] = clamp255(tensorData[plane * 2 + i]);
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/** Fits (w, h) within MAX_INPUT_DIM on the longer side, preserving aspect ratio. Returns the same size if already within bounds. */
export function fitWithinMaxDim(w: number, h: number, maxDim = MAX_INPUT_DIM): { width: number; height: number; scaled: boolean } {
  if (Math.max(w, h) <= maxDim) return { width: w, height: h, scaled: false };
  if (w >= h) {
    const width = maxDim;
    const height = Math.max(1, Math.round((h / w) * maxDim));
    return { width, height, scaled: true };
  }
  const height = maxDim;
  const width = Math.max(1, Math.round((w / h) * maxDim));
  return { width, height, scaled: true };
}

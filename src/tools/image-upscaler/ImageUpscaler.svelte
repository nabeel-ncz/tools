<script lang="ts">
  import { onDestroy } from 'svelte';
  import Dropzone from '../../design/primitives/Dropzone.svelte';
  import ProgressReadout from '../../design/primitives/ProgressReadout.svelte';
  import SplitLens from './SplitLens.svelte';
  import { loadOrt, fetchWithProgress, createSession } from './onnxSetup';
  import { canvasToPixelTensor, pixelTensorToCanvas, fitWithinMaxDim, MAX_INPUT_DIM } from './superres';

  // Xenova/swin2SR-classical-sr-x2-64 and -x4-64: ONNX exports of caidas/swin2SR-*
  // (Apache-2.0, ported from mv-lab/swin2sr, itself Apache-2.0) — verified on both
  // models' Hugging Face cards. Native checkpoints for each scale are used directly
  // rather than applying the 2x model twice for a 4x result.
  type Scale = 2 | 4;
  const MODEL_URLS: Record<Scale, string> = {
    2: 'https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64/resolve/main/onnx/model_quantized.onnx',
    4: 'https://huggingface.co/Xenova/swin2SR-classical-sr-x4-64/resolve/main/onnx/model_quantized.onnx',
  };

  type Stage = 'idle' | 'ready' | 'downloading-model' | 'inferring' | 'done' | 'error';

  let scale = $state<Scale>(2);
  let file = $state<File | null>(null);
  let originalUrl = $state('');
  let naturalWidth = $state(0);
  let naturalHeight = $state(0);
  let stage = $state<Stage>('idle');
  let modelProgress = $state(0);
  let backendLabel = $state('');
  let downscaledNote = $state('');
  let resultUrl = $state('');
  let resultWidth = $state(0);
  let resultHeight = $state(0);
  let errorMessage = $state('');

  // Not fetched until the person actually starts an upscale (see ensureSession) —
  // avoids pulling the onnxruntime-web chunk and model bytes in on mount.
  let ortModule: Awaited<ReturnType<typeof loadOrt>> | null = null;
  const sessions = new Map<Scale, Awaited<ReturnType<typeof createSession>>['session']>();
  const ioNames = new Map<Scale, { input: string; output: string }>();

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image file.'));
      img.src = url;
    });
  }

  function onFiles(files: File[]) {
    const picked = files[0];
    if (!picked) return;
    reset();
    file = picked;
    originalUrl = URL.createObjectURL(picked);
    stage = 'ready';
  }

  async function ensureSession(s: Scale) {
    if (sessions.has(s)) return;
    stage = 'downloading-model';
    modelProgress = 0;
    const [ort, modelBytes] = await Promise.all([
      loadOrt(),
      fetchWithProgress(MODEL_URLS[s], (loaded, total) => {
        modelProgress = total > 0 ? loaded / total : 0;
      }),
    ]);
    ortModule = ort;
    const result = await createSession(ort, modelBytes);
    sessions.set(s, result.session);
    ioNames.set(s, { input: result.session.inputNames[0], output: result.session.outputNames[0] });
    backendLabel = result.backend === 'webgpu' ? 'WebGPU' : 'WASM (CPU)';
  }

  async function upscale() {
    if (!file || !originalUrl) return;
    errorMessage = '';
    downscaledNote = '';
    try {
      await ensureSession(scale);
      const ort = ortModule!;
      const session = sessions.get(scale)!;
      const names = ioNames.get(scale)!;

      stage = 'inferring';
      const img = await loadImage(originalUrl);
      naturalWidth = img.naturalWidth;
      naturalHeight = img.naturalHeight;

      const fit = fitWithinMaxDim(img.naturalWidth, img.naturalHeight);
      if (fit.scaled) {
        downscaledNote = `Source is larger than ${MAX_INPUT_DIM}px on its long side, so it was downscaled to ${fit.width}×${fit.height} before upscaling, to keep inference fast and memory-safe on-device.`;
      }

      const inputCanvas = document.createElement('canvas');
      inputCanvas.width = fit.width;
      inputCanvas.height = fit.height;
      const ictx = inputCanvas.getContext('2d')!;
      ictx.drawImage(img, 0, 0, fit.width, fit.height);

      const tensorData = canvasToPixelTensor(ictx, fit.width, fit.height);
      const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, fit.height, fit.width]);

      const outputs = await session.run({ [names.input]: inputTensor });
      const outTensor = outputs[names.output];
      const outData = outTensor.data as Float32Array;
      const dims = outTensor.dims as readonly number[]; // [1, 3, outH, outW]
      const outH = dims[2];
      const outW = dims[3];

      const resultCanvas = pixelTensorToCanvas(outData, outW, outH);
      const blob: Blob = await new Promise((resolve, reject) => {
        resultCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG.'))), 'image/png');
      });

      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob);
      resultWidth = outW;
      resultHeight = outH;
      stage = 'done';
    } catch (err) {
      stage = 'error';
      errorMessage = err instanceof Error ? err.message : 'Could not upscale this image.';
    }
  }

  function setScale(s: Scale) {
    if (scale === s) return;
    scale = s;
    if (stage === 'done' || stage === 'error') stage = 'ready';
  }

  function reset() {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    file = null;
    originalUrl = '';
    resultUrl = '';
    resultWidth = 0;
    resultHeight = 0;
    naturalWidth = 0;
    naturalHeight = 0;
    downscaledNote = '';
    errorMessage = '';
    stage = 'idle';
  }

  onDestroy(() => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  });
</script>

<div class="console">
  {#if stage === 'idle'}
    <Dropzone accept="image/*" onfiles={onFiles} label="Drop an image, or click to choose" hint="PNG, JPG, or WebP" />
  {:else}
    <div class="workbench">
      <div class="scale-toggle" role="group" aria-label="Upscale factor">
        <button type="button" class="scale-btn" class:active={scale === 2} aria-pressed={scale === 2} onclick={() => setScale(2)} disabled={stage === 'downloading-model' || stage === 'inferring'}>
          2&times;
        </button>
        <button type="button" class="scale-btn" class:active={scale === 4} aria-pressed={scale === 4} onclick={() => setScale(4)} disabled={stage === 'downloading-model' || stage === 'inferring'}>
          4&times;
        </button>
      </div>

      {#if stage === 'done' && resultUrl}
        <SplitLens beforeSrc={originalUrl} afterSrc={resultUrl} beforeLabel={`${naturalWidth}×${naturalHeight}`} afterLabel={`${resultWidth}×${resultHeight}`} aspectRatio={naturalWidth && naturalHeight ? naturalWidth / naturalHeight : 4 / 3} />
      {:else}
        <div class="preview-frame">
          <img src={originalUrl} alt="Source to upscale" />
        </div>
      {/if}

      {#if downscaledNote}
        <p class="note readout">{downscaledNote}</p>
      {/if}

      {#if stage === 'downloading-model'}
        <ProgressReadout value={modelProgress} label={`Downloading ${scale}× upscaling model`} detail={`${Math.round(modelProgress * 100)}%`} />
      {:else if stage === 'inferring'}
        <ProgressReadout indeterminate label="Upscaling" detail={backendLabel} />
      {/if}

      {#if errorMessage}
        <p class="error">{errorMessage}</p>
      {/if}

      <div class="actions">
        {#if stage !== 'done'}
          <button type="button" class="primary-btn" onclick={upscale} disabled={stage === 'downloading-model' || stage === 'inferring'}>
            {stage === 'downloading-model' || stage === 'inferring' ? 'Working…' : `Upscale ${scale}×`}
          </button>
        {:else}
          <a class="download-btn" href={resultUrl} download={`${(file?.name ?? 'image').replace(/\.[^.]+$/, '')}-${scale}x.png`}>Download PNG</a>
          <button type="button" class="secondary-btn" onclick={upscale}>Re-run</button>
        {/if}
        <button type="button" class="reset-btn" onclick={reset} disabled={stage === 'downloading-model' || stage === 'inferring'}>Choose a different image</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .console {
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-6);
  }

  .workbench {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .scale-toggle {
    display: inline-flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    overflow: hidden;
    width: fit-content;
  }

  .scale-btn {
    background: var(--bg);
    border: none;
    color: var(--fg-soft);
    padding: var(--space-2) var(--space-5);
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    cursor: pointer;
    transition:
      background var(--duration-tick) var(--ease-snap),
      color var(--duration-tick) var(--ease-snap);
  }

  .scale-btn + .scale-btn {
    border-left: 1px solid var(--border-strong);
  }

  .scale-btn.active {
    background: var(--signal);
    color: #fff;
  }

  .scale-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .preview-frame {
    border: 1px solid var(--border);
    background: repeating-conic-gradient(#ccc 0% 25%, #eee 0% 50%) 0 0 / 16px 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    max-height: 480px;
    overflow: hidden;
  }

  .preview-frame img {
    max-width: 100%;
    max-height: 480px;
    object-fit: contain;
    display: block;
  }

  .note {
    font-size: var(--text-xs);
    color: var(--fg-faint);
    margin: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }

  .primary-btn,
  .download-btn {
    display: inline-flex;
    align-items: center;
    background: var(--signal);
    color: #fff;
    border: none;
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    cursor: pointer;
    text-decoration: none;
    border-radius: var(--radius-md);
  }

  .primary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .secondary-btn,
  .reset-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--fg-soft);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    transition:
      border-color var(--duration-tick) var(--ease-snap),
      color var(--duration-tick) var(--ease-snap);
  }

  .secondary-btn:hover,
  .reset-btn:hover {
    border-color: var(--signal);
    color: var(--signal);
  }

  .reset-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    color: var(--signal);
    font-size: var(--text-sm);
    margin: 0;
  }
</style>

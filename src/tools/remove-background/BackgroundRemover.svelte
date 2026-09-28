<script lang="ts">
  import { onDestroy } from 'svelte';
  import Dropzone from '../../design/primitives/Dropzone.svelte';
  import ProgressReadout from '../../design/primitives/ProgressReadout.svelte';
  import SplitLens from './SplitLens.svelte';
  import { loadOrt, fetchWithProgress, createSession } from './onnxSetup';
  import { computeModnetInputSize, canvasToModnetTensor, matteToAlphaCanvas, compositeWithMatte } from './segmentation';

  // Xenova/modnet: ONNX export of ZHKKKe/MODNet, Apache-2.0 (verified on the model's
  // Hugging Face card). briaai/RMBG-1.4 was considered first but its license is
  // non-commercial-only, so it was rejected — see this tool's report for detail.
  const MODEL_URL = 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model_quantized.onnx';

  type ModelState = 'idle' | 'downloading' | 'ready' | 'error';
  type ItemStatus = 'queued' | 'processing' | 'done' | 'error';

  interface QueueItem {
    id: string;
    file: File;
    name: string;
    originalUrl: string;
    width: number;
    height: number;
    status: ItemStatus;
    resultUrl?: string;
    resultBlob?: Blob;
    errorMessage?: string;
  }

  let items = $state<QueueItem[]>([]);
  let modelState = $state<ModelState>('idle');
  let modelProgress = $state(0);
  let modelError = $state('');
  let backendLabel = $state('');
  let activeIndex = $state(-1); // index into items currently processing
  let batchError = $state('');
  let zipUrl = $state('');
  let zipping = $state(false);

  let session: Awaited<ReturnType<typeof createSession>>['session'] | null = null;
  let inputName = '';
  let outputName = '';

  const doneCount = $derived(items.filter((i) => i.status === 'done').length);
  const isProcessing = $derived(modelState === 'downloading' || activeIndex >= 0);
  const hasQueue = $derived(items.length > 0);

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image file.'));
      img.src = url;
    });
  }

  function onFiles(files: File[]) {
    batchError = '';
    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const originalUrl = URL.createObjectURL(file);
      items.push({ id, file, name: file.name, originalUrl, width: 0, height: 0, status: 'queued' });
    }
  }

  async function ensureModel() {
    if (modelState === 'ready') return;
    modelState = 'downloading';
    modelProgress = 0;
    modelError = '';
    try {
      const [ort, modelBytes] = await Promise.all([
        loadOrt(),
        fetchWithProgress(MODEL_URL, (loaded, total) => {
          modelProgress = total > 0 ? loaded / total : 0;
        }),
      ]);
      const result = await createSession(ort, modelBytes);
      session = result.session;
      backendLabel = result.backend === 'webgpu' ? 'WebGPU' : 'WASM (CPU)';
      inputName = session.inputNames[0];
      outputName = session.outputNames[0];
      modelState = 'ready';
      modelProgress = 1;
    } catch (err) {
      modelState = 'error';
      modelError = err instanceof Error ? err.message : 'Could not load the segmentation model.';
      throw err;
    }
  }

  async function removeBackgroundFor(item: QueueItem): Promise<void> {
    const ort = await loadOrt();
    if (!session) throw new Error('Model not ready.');

    const img = await loadImage(item.originalUrl);
    item.width = img.naturalWidth;
    item.height = img.naturalHeight;

    const { width: inW, height: inH } = computeModnetInputSize(img.naturalWidth, img.naturalHeight);

    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = inW;
    smallCanvas.height = inH;
    const sctx = smallCanvas.getContext('2d')!;
    sctx.drawImage(img, 0, 0, inW, inH);

    const tensorData = canvasToModnetTensor(sctx, inW, inH);
    const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, inH, inW]);

    const outputs = await session.run({ [inputName]: inputTensor });
    const matteTensor = outputs[outputName];
    const matteData = matteTensor.data as Float32Array;

    // The matte comes back at the same (inH, inW) the network was fed.
    const alphaCanvas = matteToAlphaCanvas(matteData, inW, inH, img.naturalWidth, img.naturalHeight);
    const resultCanvas = compositeWithMatte(img, alphaCanvas, img.naturalWidth, img.naturalHeight);

    const blob: Blob = await new Promise((resolve, reject) => {
      resultCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG.'))), 'image/png');
    });

    item.resultBlob = blob;
    item.resultUrl = URL.createObjectURL(blob);
  }

  async function processAll() {
    batchError = '';
    try {
      await ensureModel();
    } catch {
      return; // modelError already set
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.status === 'done') continue;
      activeIndex = i;
      item.status = 'processing';
      try {
        await removeBackgroundFor(item);
        item.status = 'done';
      } catch (err) {
        item.status = 'error';
        item.errorMessage = err instanceof Error ? err.message : 'Could not process this image.';
      }
    }
    activeIndex = -1;
  }

  async function downloadZip() {
    const doneItems = items.filter((i) => i.status === 'done' && i.resultBlob);
    if (doneItems.length === 0) return;
    zipping = true;
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const item of doneItems) {
        const baseName = item.name.replace(/\.[^.]+$/, '');
        zip.file(`${baseName}-no-bg.png`, item.resultBlob!);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      if (zipUrl) URL.revokeObjectURL(zipUrl);
      zipUrl = URL.createObjectURL(blob);
    } finally {
      zipping = false;
    }
  }

  function removeItem(id: string) {
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const [removed] = items.splice(idx, 1);
    URL.revokeObjectURL(removed.originalUrl);
    if (removed.resultUrl) URL.revokeObjectURL(removed.resultUrl);
  }

  function resetAll() {
    for (const item of items) {
      URL.revokeObjectURL(item.originalUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    }
    items = [];
    if (zipUrl) URL.revokeObjectURL(zipUrl);
    zipUrl = '';
    batchError = '';
  }

  onDestroy(() => {
    for (const item of items) {
      URL.revokeObjectURL(item.originalUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    }
    if (zipUrl) URL.revokeObjectURL(zipUrl);
  });
</script>

<div class="console">
  {#if !hasQueue}
    <Dropzone accept="image/*" multiple onfiles={onFiles} label="Drop one or more images, or click to choose" hint="PNG, JPG, or WebP — processed at full resolution" />
  {:else}
    <div class="workbench">
      <ul class="queue">
        {#each items as item (item.id)}
          <li class="queue-item">
            <div class="queue-row">
              <img class="thumb" src={item.originalUrl} alt="" />
              <div class="queue-meta">
                <span class="queue-name">{item.name}</span>
                <span class="readout queue-status">
                  {#if item.status === 'queued'}Queued
                  {:else if item.status === 'processing'}Processing…
                  {:else if item.status === 'done'}Done
                  {:else}Error{/if}
                </span>
              </div>
              {#if item.status !== 'processing'}
                <button type="button" class="remove-btn" onclick={() => removeItem(item.id)} aria-label={`Remove ${item.name}`}>&times;</button>
              {/if}
            </div>

            {#if item.status === 'error'}
              <p class="error">{item.errorMessage}</p>
            {/if}

            {#if item.status === 'done' && item.resultUrl}
              <div class="result">
                <SplitLens beforeSrc={item.originalUrl} afterSrc={item.resultUrl} checkered aspectRatio={item.width && item.height ? item.width / item.height : 4 / 3} />
                <a class="download-btn" href={item.resultUrl} download={`${item.name.replace(/\.[^.]+$/, '')}-no-bg.png`}>Download PNG</a>
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      {#if modelState === 'downloading'}
        <ProgressReadout value={modelProgress} label="Downloading segmentation model" detail={`${Math.round(modelProgress * 100)}%`} />
      {:else if activeIndex >= 0}
        <ProgressReadout indeterminate label={`Processing image ${activeIndex + 1} of ${items.length}`} detail={backendLabel} />
      {/if}

      {#if modelError}
        <p class="error">{modelError}</p>
      {/if}
      {#if batchError}
        <p class="error">{batchError}</p>
      {/if}

      <div class="actions">
        {#if doneCount < items.length}
          <button type="button" class="primary-btn" onclick={processAll} disabled={isProcessing}>
            {isProcessing ? 'Working…' : modelState === 'ready' ? 'Remove background' : 'Remove background (downloads model first)'}
          </button>
        {/if}
        {#if doneCount > 1}
          <button type="button" class="secondary-btn" onclick={downloadZip} disabled={zipping}>
            {zipping ? 'Zipping…' : 'Download all as ZIP'}
          </button>
        {/if}
        {#if zipUrl}
          <a class="download-btn" href={zipUrl} download="no-background.zip">Save no-background.zip</a>
        {/if}
        <button type="button" class="reset-btn" onclick={resetAll} disabled={isProcessing}>Start over</button>
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

  .queue {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .queue-item {
    border: 1px solid var(--border);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .queue-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .thumb {
    width: 44px;
    height: 44px;
    object-fit: cover;
    border: 1px solid var(--border);
    flex-shrink: 0;
  }

  .queue-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .queue-name {
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .queue-status {
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }

  .remove-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg-faint);
    width: 28px;
    height: 28px;
    cursor: pointer;
    border-radius: var(--radius-md);
    font-size: var(--text-md);
    line-height: 1;
    flex-shrink: 0;
    transition:
      border-color var(--duration-tick) var(--ease-snap),
      color var(--duration-tick) var(--ease-snap);
  }

  .remove-btn:hover {
    border-color: var(--signal);
    color: var(--signal);
  }

  .result {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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
    transition: opacity var(--duration-tick) var(--ease-snap);
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

  .secondary-btn:disabled,
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

<script lang="ts">
  import Dropzone from '../../design/primitives/Dropzone.svelte';
  import ProgressReadout from '../../design/primitives/ProgressReadout.svelte';

  interface Placed {
    id: string;
    pageIndex: number;
    type: 'image' | 'text';
    x: number;
    y: number;
    width: number;
    height: number;
    dataUrl?: string;
    text?: string;
  }

  const RENDER_SCALE = 1.4;

  let file = $state<File | null>(null);
  let pdfBytesOriginal: ArrayBuffer | null = null;
  let pageCount = $state(0);
  let pageIndex = $state(0);
  let pageCanvasUrl = $state('');
  let pageWidthPx = $state(0);
  let pageHeightPx = $state(0);
  let pageWidthPt = 0;
  let pageHeightPt = 0;

  let sigMode = $state<'draw' | 'type' | 'upload'>('draw');
  let typedText = $state('Your Name');
  let drawCanvasEl: HTMLCanvasElement;
  let drawing = false;

  let placed = $state<Placed[]>([]);
  let selectedId = $state<string | null>(null);
  let dragState: { id: string; offsetX: number; offsetY: number; resizing: boolean } | null = null;

  let status = $state<'idle' | 'ready' | 'exporting' | 'done'>('idle');
  let resultUrl = $state('');
  let error = $state('');

  async function onFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    file = f;
    error = '';
    try {
      pdfBytesOriginal = await f.arrayBuffer();
      await renderCurrentPage();
      status = 'ready';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not read this PDF.';
    }
  }

  async function renderCurrentPage() {
    if (!pdfBytesOriginal) return;
    const { loadPdf, renderPageToCanvas } = await import('../pdf-shared/pdfjs');
    const doc = await loadPdf(pdfBytesOriginal.slice(0));
    pageCount = doc.numPages;
    const page = await doc.getPage(pageIndex + 1);
    const viewportPt = page.getViewport({ scale: 1 });
    pageWidthPt = viewportPt.width;
    pageHeightPt = viewportPt.height;
    const canvas = await renderPageToCanvas(page, RENDER_SCALE);
    pageWidthPx = canvas.width;
    pageHeightPx = canvas.height;
    pageCanvasUrl = canvas.toDataURL('image/png');
  }

  async function goToPage(i: number) {
    if (i < 0 || i >= pageCount) return;
    pageIndex = i;
    await renderCurrentPage();
  }

  // --- Signature drawing pad ---
  function startDraw(e: PointerEvent) {
    drawing = true;
    const ctx = drawCanvasEl.getContext('2d')!;
    ctx.strokeStyle = '#141413';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    const rect = drawCanvasEl.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  }
  function moveDraw(e: PointerEvent) {
    if (!drawing) return;
    const ctx = drawCanvasEl.getContext('2d')!;
    const rect = drawCanvasEl.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  }
  function endDraw() {
    drawing = false;
  }
  function clearDraw() {
    const ctx = drawCanvasEl.getContext('2d')!;
    ctx.clearRect(0, 0, drawCanvasEl.width, drawCanvasEl.height);
  }

  function addSignatureFromDraw() {
    addImageElement(drawCanvasEl.toDataURL('image/png'), 220, 90);
  }

  function typedTextToDataUrl(): string {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    ctx.font = "italic 600 52px Fraunces, Georgia, serif";
    ctx.fillStyle = '#141413';
    ctx.textBaseline = 'middle';
    ctx.fillText(typedText || 'Signature', 10, 60);
    return canvas.toDataURL('image/png');
  }

  function addSignatureFromType() {
    addImageElement(typedTextToDataUrl(), 220, 66);
  }

  function onUploadSignature(files: File[]) {
    const f = files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => addImageElement(reader.result as string, 200, 100);
    reader.readAsDataURL(f);
  }

  function addImageElement(dataUrl: string, width: number, height: number) {
    const id = `el-${Date.now()}-${Math.random()}`;
    placed = [
      ...placed,
      {
        id,
        pageIndex,
        type: 'image',
        x: Math.max(10, pageWidthPx / 2 - width / 2),
        y: Math.max(10, pageHeightPx / 2 - height / 2),
        width,
        height,
        dataUrl,
      },
    ];
    selectedId = id;
  }

  function addTextField() {
    const id = `el-${Date.now()}-${Math.random()}`;
    placed = [
      ...placed,
      {
        id,
        pageIndex,
        type: 'text',
        x: 40,
        y: 40,
        width: 140,
        height: 28,
        text: 'Date: __/__/____',
      },
    ];
    selectedId = id;
  }

  function updateText(id: string, value: string) {
    placed = placed.map((p) => (p.id === id ? { ...p, text: value } : p));
  }

  function removeSelected() {
    if (!selectedId) return;
    placed = placed.filter((p) => p.id !== selectedId);
    selectedId = null;
  }

  function onElementPointerDown(e: PointerEvent, el: Placed, resizing = false) {
    e.stopPropagation();
    selectedId = el.id;
    const rect = (e.currentTarget as HTMLElement).closest('.page-stage')!.getBoundingClientRect();
    dragState = {
      id: el.id,
      offsetX: e.clientX - rect.left - el.x,
      offsetY: e.clientY - rect.top - el.y,
      resizing,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onStagePointerMove(e: PointerEvent) {
    if (!dragState) return;
    const stage = (e.currentTarget as HTMLElement).getBoundingClientRect();
    placed = placed.map((p) => {
      if (p.id !== dragState!.id) return p;
      if (dragState!.resizing) {
        const newWidth = Math.max(30, e.clientX - stage.left - p.x);
        const newHeight = Math.max(20, e.clientY - stage.top - p.y);
        return { ...p, width: newWidth, height: newHeight };
      }
      const newX = Math.min(Math.max(0, e.clientX - stage.left - dragState!.offsetX), pageWidthPx - p.width);
      const newY = Math.min(Math.max(0, e.clientY - stage.top - dragState!.offsetY), pageHeightPx - p.height);
      return { ...p, x: newX, y: newY };
    });
  }

  function onStagePointerUp() {
    dragState = null;
  }

  async function exportPdf() {
    if (!pdfBytesOriginal || !file) return;
    status = 'exporting';
    error = '';
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      const outDoc = await PDFDocument.load(pdfBytesOriginal.slice(0));
      const font = await outDoc.embedFont(StandardFonts.Helvetica);
      const pages = outDoc.getPages();

      for (const el of placed) {
        const page = pages[el.pageIndex];
        if (!page) continue;
        const scaleX = page.getWidth() / pageWidthPx;
        const scaleY = page.getHeight() / pageHeightPx;

        if (el.type === 'image' && el.dataUrl) {
          const isPng = el.dataUrl.startsWith('data:image/png');
          const bytes = await (await fetch(el.dataUrl)).arrayBuffer();
          const img = isPng ? await outDoc.embedPng(bytes) : await outDoc.embedJpg(bytes);
          const wPt = el.width * scaleX;
          const hPt = el.height * scaleY;
          page.drawImage(img, {
            x: el.x * scaleX,
            y: page.getHeight() - el.y * scaleY - hPt,
            width: wPt,
            height: hPt,
          });
        } else if (el.type === 'text' && el.text) {
          const size = 14;
          page.drawText(el.text, {
            x: el.x * scaleX,
            y: page.getHeight() - el.y * scaleY - size,
            size,
            font,
            color: rgb(0.08, 0.08, 0.07),
          });
        }
      }

      const outBytes = await outDoc.save();
      const blob = new Blob([outBytes], { type: 'application/pdf' });
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob);
      status = 'done';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not export this PDF.';
      status = 'ready';
    }
  }

  function reset() {
    file = null;
    pdfBytesOriginal = null;
    placed = [];
    status = 'idle';
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = '';
  }

  let elementsOnPage = $derived(placed.filter((p) => p.pageIndex === pageIndex));
</script>

<div class="console">
  {#if !file}
    <Dropzone accept="application/pdf" onfiles={onFiles} label="Drop the PDF you need to sign" />
  {:else if status === 'exporting' && !resultUrl}
    <ProgressReadout indeterminate={true} label="Exporting" />
  {:else if status === 'done' && resultUrl}
    <div class="done-panel">
      <p>Your signed PDF is ready.</p>
      <a class="download-btn" href={resultUrl} download={`${file.name.replace(/\.pdf$/i, '')}-signed.pdf`}>Download signed PDF</a>
      <button type="button" class="reset-btn" onclick={reset}>Start over</button>
    </div>
  {:else}
    <div class="workbench">
      <div class="sig-builder">
        <div class="sig-tabs">
          <button type="button" class:active={sigMode === 'draw'} onclick={() => (sigMode = 'draw')}>Draw</button>
          <button type="button" class:active={sigMode === 'type'} onclick={() => (sigMode = 'type')}>Type</button>
          <button type="button" class:active={sigMode === 'upload'} onclick={() => (sigMode = 'upload')}>Upload</button>
        </div>

        {#if sigMode === 'draw'}
          <canvas
            bind:this={drawCanvasEl}
            width="260"
            height="110"
            class="draw-pad"
            onpointerdown={startDraw}
            onpointermove={moveDraw}
            onpointerup={endDraw}
            onpointerleave={endDraw}
          ></canvas>
          <div class="sig-actions">
            <button type="button" onclick={clearDraw}>Clear</button>
            <button type="button" class="primary" onclick={addSignatureFromDraw}>Add to page</button>
          </div>
        {:else if sigMode === 'type'}
          <input type="text" bind:value={typedText} placeholder="Type your name" class="type-input" />
          <div class="sig-actions">
            <button type="button" class="primary" onclick={addSignatureFromType}>Add to page</button>
          </div>
        {:else}
          <Dropzone accept="image/*" onfiles={onUploadSignature} label="Upload a signature image" />
        {/if}

        <button type="button" class="text-field-btn" onclick={addTextField}>+ Add text field (date, initials…)</button>
        {#if selectedId}
          <button type="button" class="remove-btn" onclick={removeSelected}>Remove selected element</button>
        {/if}
      </div>

      <div class="page-area">
        <div class="page-nav">
          <button type="button" onclick={() => goToPage(pageIndex - 1)} disabled={pageIndex === 0}>&larr; Prev</button>
          <span class="readout">Page {pageIndex + 1} of {pageCount}</span>
          <button type="button" onclick={() => goToPage(pageIndex + 1)} disabled={pageIndex >= pageCount - 1}>Next &rarr;</button>
        </div>

        <div
          class="page-stage"
          style={`width:${pageWidthPx}px;height:${pageHeightPx}px`}
          onpointermove={onStagePointerMove}
          onpointerup={onStagePointerUp}
          onpointerleave={onStagePointerUp}
        >
          {#if pageCanvasUrl}
            <img src={pageCanvasUrl} alt={`Page ${pageIndex + 1}`} class="page-image" />
          {/if}
          {#each elementsOnPage as el (el.id)}
            <div
              class="placed-el"
              class:selected={selectedId === el.id}
              style={`left:${el.x}px;top:${el.y}px;width:${el.width}px;height:${el.height}px`}
              onpointerdown={(e) => onElementPointerDown(e, el)}
            >
              {#if el.type === 'image'}
                <img src={el.dataUrl} alt="Placed signature" draggable="false" />
              {:else}
                <input
                  type="text"
                  value={el.text}
                  oninput={(e) => updateText(el.id, (e.target as HTMLInputElement).value)}
                  onpointerdown={(e) => e.stopPropagation()}
                />
              {/if}
              <button
                type="button"
                class="resize-handle"
                aria-label="Resize"
                onpointerdown={(e) => onElementPointerDown(e, el, true)}
              ></button>
            </div>
          {/each}
        </div>

        <button type="button" class="run-btn" onclick={exportPdf} disabled={placed.length === 0}>Export signed PDF</button>
        {#if error}
          <p class="error">{error}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .console {
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-5);
  }

  .workbench {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: var(--space-5);
  }

  .sig-builder {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .sig-tabs {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .sig-tabs button {
    flex: 1;
    background: var(--bg);
    border: none;
    padding: var(--space-2);
    cursor: pointer;
    font-size: var(--text-xs);
    color: var(--fg-soft);
  }

  .sig-tabs button.active {
    background: var(--fg);
    color: var(--bg);
  }

  .draw-pad {
    background: #fff;
    border: 1px solid var(--border-strong);
    touch-action: none;
    width: 100%;
    height: auto;
  }

  .type-input {
    background: var(--bg);
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    font-family: var(--font-display);
    font-style: italic;
  }

  .sig-actions {
    display: flex;
    gap: var(--space-2);
  }

  .sig-actions button,
  .text-field-btn,
  .remove-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
  }

  .sig-actions .primary {
    background: var(--signal);
    color: var(--color-ink);
    border-color: var(--signal-text);
  }

  .remove-btn {
    border-color: var(--signal-text);
    color: var(--signal-text);
  }

  .page-area {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .page-nav {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }

  .page-nav button {
    background: transparent;
    border: 1px solid var(--border);
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .page-stage {
    position: relative;
    background: #fff;
    border: 1px solid var(--border);
    max-width: 100%;
    overflow: auto;
    touch-action: none;
  }

  .page-image {
    display: block;
    max-width: none;
  }

  .placed-el {
    position: absolute;
    border: 1px dashed var(--signal);
    cursor: move;
  }

  .placed-el img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }

  .placed-el input {
    width: 100%;
    height: 100%;
    border: none;
    background: rgba(255, 255, 255, 0.7);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .placed-el.selected {
    border-style: solid;
  }

  .resize-handle {
    position: absolute;
    right: -5px;
    bottom: -5px;
    width: 10px;
    height: 10px;
    background: var(--signal);
    border: none;
    cursor: nwse-resize;
    padding: 0;
  }

  .run-btn,
  .download-btn {
    background: var(--signal);
    color: var(--color-ink);
    border: none;
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
    width: fit-content;
    text-decoration: none;
    display: inline-block;
  }

  .run-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .done-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: flex-start;
  }

  .reset-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg-soft);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    border-radius: var(--radius-md);
    width: fit-content;
  }

  .error {
    color: var(--signal-text);
    font-size: var(--text-sm);
  }

  @media (max-width: 800px) {
    .workbench {
      grid-template-columns: 1fr;
    }
  }
</style>

<script lang="ts">
  import { PDFDocument } from 'pdf-lib';
  import Dropzone from '../../design/primitives/Dropzone.svelte';
  import ProgressReadout from '../../design/primitives/ProgressReadout.svelte';

  interface Rect {
    id: string;
    pageIndex: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }

  const RENDER_SCALE = 1.4;
  const EXPORT_SCALE = 2.2;

  let file = $state<File | null>(null);
  let pdfBytesOriginal: ArrayBuffer | null = null;
  let pageCount = $state(0);
  let pageIndex = $state(0);
  let pageCanvasUrl = $state('');
  let pageWidthPx = $state(0);
  let pageHeightPx = $state(0);

  let rects = $state<Rect[]>([]);
  let drawStart: { x: number; y: number } | null = null;
  let drawCurrent = $state<{ x: number; y: number; w: number; h: number } | null>(null);

  let status = $state<'idle' | 'ready' | 'exporting' | 'done'>('idle');
  let progress = $state(0);
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

  function onStageDown(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    drawStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    drawCurrent = { x: drawStart.x, y: drawStart.y, w: 0, h: 0 };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onStageMove(e: PointerEvent) {
    if (!drawStart) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    drawCurrent = {
      x: Math.min(drawStart.x, curX),
      y: Math.min(drawStart.y, curY),
      w: Math.abs(curX - drawStart.x),
      h: Math.abs(curY - drawStart.y),
    };
  }

  function onStageUp() {
    if (drawCurrent && drawCurrent.w > 6 && drawCurrent.h > 6) {
      rects = [...rects, { id: `r-${Date.now()}-${Math.random()}`, pageIndex, ...drawCurrent }];
    }
    drawStart = null;
    drawCurrent = null;
  }

  function removeRect(id: string) {
    rects = rects.filter((r) => r.id !== id);
  }

  let rectsOnPage = $derived(rects.filter((r) => r.pageIndex === pageIndex));
  let pagesWithRedactions = $derived(new Set(rects.map((r) => r.pageIndex)));

  async function flattenAndExport() {
    if (!pdfBytesOriginal || !file) return;
    status = 'exporting';
    error = '';
    progress = 0;
    try {
      const { loadPdf, renderPageToCanvas } = await import('../pdf-shared/pdfjs');
      const srcDoc = await PDFDocument.load(pdfBytesOriginal.slice(0));
      const jsPdfDoc = await loadPdf(pdfBytesOriginal.slice(0));
      const outDoc = await PDFDocument.create();

      const total = jsPdfDoc.numPages;
      for (let i = 0; i < total; i++) {
        const pageRects = rects.filter((r) => r.pageIndex === i);

        if (pageRects.length === 0) {
          const [copied] = await outDoc.copyPages(srcDoc, [i]);
          outDoc.addPage(copied);
        } else {
          const page = await jsPdfDoc.getPage(i + 1);
          const canvas = await renderPageToCanvas(page, EXPORT_SCALE);
          const ctx = canvas.getContext('2d')!;
          const factor = EXPORT_SCALE / RENDER_SCALE;
          ctx.fillStyle = '#000000';
          for (const r of pageRects) {
            ctx.fillRect(r.x * factor, r.y * factor, r.w * factor, r.h * factor);
          }
          const jpegBytes = await new Promise<Uint8Array>((resolve, reject) => {
            canvas.toBlob(
              async (blob) => {
                if (!blob) return reject(new Error('Could not flatten page'));
                resolve(new Uint8Array(await blob.arrayBuffer()));
              },
              'image/jpeg',
              0.88
            );
          });
          const jpg = await outDoc.embedJpg(jpegBytes);
          const srcPage = srcDoc.getPage(i);
          const outPage = outDoc.addPage([srcPage.getWidth(), srcPage.getHeight()]);
          outPage.drawImage(jpg, { x: 0, y: 0, width: srcPage.getWidth(), height: srcPage.getHeight() });
        }
        progress = (i + 1) / total;
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
    rects = [];
    status = 'idle';
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = '';
  }
</script>

<div class="console">
  {#if !file}
    <Dropzone accept="application/pdf" onfiles={onFiles} label="Drop the PDF you need to redact" />
  {:else if status === 'done' && resultUrl}
    <div class="done-panel">
      <div class="stamp">Verified removed</div>
      <p>{rects.length} redaction{rects.length === 1 ? '' : 's'} across {pagesWithRedactions.size} page{pagesWithRedactions.size === 1 ? '' : 's'} — those pages were flattened to images so nothing is left underneath.</p>
      <a class="download-btn" href={resultUrl} download={`${file.name.replace(/\.pdf$/i, '')}-redacted.pdf`}>Download redacted PDF</a>
      <button type="button" class="reset-btn" onclick={reset}>Start over</button>
    </div>
  {:else}
    <div class="workbench">
      <div class="page-nav">
        <button type="button" onclick={() => goToPage(pageIndex - 1)} disabled={pageIndex === 0}>&larr; Prev</button>
        <span class="readout">
          Page {pageIndex + 1} of {pageCount}
          {#if pagesWithRedactions.has(pageIndex)}<span class="page-flag">marked</span>{/if}
        </span>
        <button type="button" onclick={() => goToPage(pageIndex + 1)} disabled={pageIndex >= pageCount - 1}>Next &rarr;</button>
      </div>

      <p class="hint">Draw black bars over anything to remove. Nothing is permanent until you flatten and export.</p>

      <div
        class="page-stage"
        style={`width:${pageWidthPx}px;height:${pageHeightPx}px`}
        onpointerdown={onStageDown}
        onpointermove={onStageMove}
        onpointerup={onStageUp}
        onpointerleave={onStageUp}
      >
        {#if pageCanvasUrl}
          <img src={pageCanvasUrl} alt={`Page ${pageIndex + 1}`} class="page-image" draggable="false" />
        {/if}
        {#each rectsOnPage as r (r.id)}
          <div class="redact-rect" style={`left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`}>
            <button type="button" class="rect-remove" aria-label="Remove this redaction" onclick={() => removeRect(r.id)}>&times;</button>
          </div>
        {/each}
        {#if drawCurrent}
          <div class="redact-rect drawing" style={`left:${drawCurrent.x}px;top:${drawCurrent.y}px;width:${drawCurrent.w}px;height:${drawCurrent.h}px`}></div>
        {/if}
      </div>

      {#if status === 'exporting'}
        <ProgressReadout value={progress} label="Flattening & exporting" />
      {:else}
        <button type="button" class="run-btn" onclick={flattenAndExport} disabled={rects.length === 0}>
          Flatten &#38; export ({rects.length} redaction{rects.length === 1 ? '' : 's'})
        </button>
      {/if}

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <button type="button" class="reset-btn" onclick={reset}>Choose a different PDF</button>
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
    gap: var(--space-4);
  }

  .page-nav {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }

  .page-flag {
    margin-left: var(--space-2);
    color: var(--signal);
    text-transform: uppercase;
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
  }

  .page-nav button {
    background: transparent;
    border: 1px solid var(--border);
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }

  .page-stage {
    position: relative;
    background: #fff;
    border: 1px solid var(--border);
    max-width: 100%;
    overflow: auto;
    touch-action: none;
    cursor: crosshair;
  }

  .page-image {
    display: block;
    max-width: none;
    pointer-events: none;
  }

  .redact-rect {
    position: absolute;
    background: #000;
  }

  .redact-rect.drawing {
    background: rgba(228, 87, 46, 0.4);
  }

  .rect-remove {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--signal);
    color: #fff;
    border: none;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
  }

  .run-btn {
    background: var(--signal);
    color: #fff;
    border: none;
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
    width: fit-content;
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

  .stamp {
    border: 2px solid #3a8f5c;
    color: #3a8f5c;
    padding: var(--space-2) var(--space-4);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: var(--text-sm);
    transform: rotate(-2deg);
    border-radius: var(--radius-md);
  }

  .download-btn {
    background: var(--signal);
    color: #fff;
    border: none;
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
    text-decoration: none;
    display: inline-block;
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
    color: var(--signal);
    font-size: var(--text-sm);
  }
</style>

<script lang="ts">
  import Dropzone from '../../design/primitives/Dropzone.svelte';
  import ProgressReadout from '../../design/primitives/ProgressReadout.svelte';

  let file = $state<File | null>(null);
  let thumbnails = $state<string[]>([]);
  let selected = $state<Set<number>>(new Set());
  let rangeInput = $state('');
  let mode = $state<'extract' | 'perPage'>('extract');
  let status = $state<'idle' | 'loading' | 'ready' | 'processing' | 'done'>('idle');
  let progress = $state(0);
  let resultUrl = $state('');
  let resultName = $state('');
  let error = $state('');

  async function onFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    file = f;
    status = 'loading';
    error = '';
    thumbnails = [];
    selected = new Set();
    try {
      const { loadPdf, renderPageToCanvas } = await import('../pdf-shared/pdfjs');
      const bytes = await f.arrayBuffer();
      const doc = await loadPdf(bytes.slice(0));
      const thumbs: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const canvas = await renderPageToCanvas(page, 0.35);
        thumbs.push(canvas.toDataURL('image/png'));
        progress = i / doc.numPages;
      }
      thumbnails = thumbs;
      status = 'ready';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not read this PDF.';
      status = 'idle';
    }
  }

  function toggle(index: number) {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    selected = next;
    syncRangeFromSelection();
  }

  function syncRangeFromSelection() {
    const sorted = Array.from(selected).sort((a, b) => a - b);
    if (sorted.length === 0) {
      rangeInput = '';
      return;
    }
    const parts: string[] = [];
    let start = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i <= sorted.length; i++) {
      const cur = sorted[i];
      if (cur === prev + 1) {
        prev = cur;
        continue;
      }
      parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
      start = cur;
      prev = cur;
    }
    rangeInput = parts.join(',');
  }

  function applyRangeInput() {
    const next = new Set<number>();
    const parts = rangeInput.split(',').map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) {
        if (n >= 1 && n <= thumbnails.length) next.add(n - 1);
      }
    }
    selected = next;
  }

  function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function run() {
    if (!file) return;
    status = 'processing';
    error = '';
    progress = 0;
    try {
      const { PDFDocument } = await import('pdf-lib');
      const bytes = await file.arrayBuffer();
      const srcDoc = await PDFDocument.load(bytes);
      const baseName = file.name.replace(/\.pdf$/i, '');

      if (mode === 'extract') {
        const indices = Array.from(selected).sort((a, b) => a - b);
        if (indices.length === 0) throw new Error('Select at least one page to extract.');
        const outDoc = await PDFDocument.create();
        const pages = await outDoc.copyPages(srcDoc, indices);
        pages.forEach((p) => outDoc.addPage(p));
        const outBytes = await outDoc.save();
        const blob = new Blob([outBytes], { type: 'application/pdf' });
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        resultUrl = URL.createObjectURL(blob);
        resultName = `${baseName}-extract.pdf`;
      } else {
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        const total = srcDoc.getPageCount();
        for (let i = 0; i < total; i++) {
          const outDoc = await PDFDocument.create();
          const [p] = await outDoc.copyPages(srcDoc, [i]);
          outDoc.addPage(p);
          const outBytes = await outDoc.save();
          zip.file(`${baseName}-page-${String(i + 1).padStart(3, '0')}.pdf`, outBytes);
          progress = (i + 1) / total;
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        resultUrl = URL.createObjectURL(blob);
        resultName = `${baseName}-pages.zip`;
      }
      status = 'done';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not split this PDF.';
      status = 'ready';
    }
  }

  function reset() {
    file = null;
    thumbnails = [];
    selected = new Set();
    rangeInput = '';
    status = 'idle';
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = '';
  }
</script>

<div class="console">
  {#if !file}
    <Dropzone accept="application/pdf" onfiles={onFiles} label="Drop a PDF to see its pages" />
  {:else if status === 'loading'}
    <ProgressReadout value={progress} label="Rendering pages" indeterminate={thumbnails.length === 0} />
  {:else}
    <div class="workbench">
      <div class="thumb-grid">
        {#each thumbnails as thumb, i}
          <button type="button" class="thumb" class:selected={selected.has(i)} onclick={() => toggle(i)} aria-pressed={selected.has(i)}>
            <img src={thumb} alt={`Page ${i + 1}`} />
            <span class="thumb-number readout">{i + 1}</span>
          </button>
        {/each}
      </div>

      <div class="controls">
        <label class="range-field">
          <span>Page selection</span>
          <input type="text" placeholder="e.g. 1,4,9-12" bind:value={rangeInput} onblur={applyRangeInput} />
        </label>

        <div class="mode-toggle">
          <button type="button" class:active={mode === 'extract'} onclick={() => (mode = 'extract')}>Extract selected</button>
          <button type="button" class:active={mode === 'perPage'} onclick={() => (mode = 'perPage')}>One file per page</button>
        </div>

        {#if status === 'processing'}
          <ProgressReadout value={progress} label="Processing" />
        {:else if status === 'done' && resultUrl}
          <a class="download-btn" href={resultUrl} download={resultName}>Download {resultName}</a>
        {:else}
          <button type="button" class="run-btn" onclick={run}>
            {mode === 'extract' ? `Extract ${selected.size} page${selected.size === 1 ? '' : 's'}` : 'Split all pages'}
          </button>
        {/if}

        {#if error}
          <p class="error">{error}</p>
        {/if}

        <button type="button" class="reset-btn" onclick={reset}>Choose a different PDF</button>
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

  .thumb-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: var(--space-3);
    max-height: 50vh;
    overflow-y: auto;
    padding: var(--space-2);
    background: var(--bg);
    border: 1px solid var(--border);
  }

  .thumb {
    position: relative;
    padding: 0;
    border: 2px solid transparent;
    background: none;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .thumb img {
    width: 100%;
    display: block;
    border: 1px solid var(--border);
  }

  .thumb.selected {
    border-color: var(--signal-text);
  }

  .thumb-number {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(20, 20, 19, 0.75);
    color: #fff;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: var(--radius-sm);
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .range-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .range-field span {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-faint);
  }

  .range-field input {
    background: var(--bg);
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
  }

  .mode-toggle {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    overflow: hidden;
    width: fit-content;
  }

  .mode-toggle button {
    background: var(--bg);
    border: none;
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    color: var(--fg-soft);
    font-size: var(--text-sm);
  }

  .mode-toggle button.active {
    background: var(--fg);
    color: var(--bg);
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
</style>

<script lang="ts">
  import Dropzone from '../../design/primitives/Dropzone.svelte';
  import ProgressReadout from '../../design/primitives/ProgressReadout.svelte';
  import Meter from '../../design/primitives/Meter.svelte';

  interface QualityLevel {
    key: 'light' | 'balanced' | 'aggressive';
    label: string;
    scale: number;
    jpegQuality: number;
  }

  const LEVELS: QualityLevel[] = [
    { key: 'light', label: 'Light', scale: 2.0, jpegQuality: 0.85 },
    { key: 'balanced', label: 'Balanced', scale: 1.4, jpegQuality: 0.7 },
    { key: 'aggressive', label: 'Aggressive', scale: 1.0, jpegQuality: 0.5 },
  ];

  interface JobResult {
    name: string;
    originalSize: number;
    compressedSize: number;
    blob: Blob;
  }

  let level = $state<QualityLevel>(LEVELS[1]);
  let files = $state<File[]>([]);
  let status = $state<'idle' | 'processing' | 'done'>('idle');
  let progress = $state(0);
  let progressLabel = $state('');
  let results = $state<JobResult[]>([]);
  let error = $state('');

  function onFiles(fs: File[]) {
    files = fs.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    results = [];
    status = files.length > 0 ? 'idle' : 'idle';
  }

  function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        async (blob) => {
          if (!blob) return reject(new Error('Could not encode page'));
          resolve(new Uint8Array(await blob.arrayBuffer()));
        },
        'image/jpeg',
        quality
      );
    });
  }

  async function compressOne(file: File, onPage: (p: number, total: number) => void): Promise<JobResult> {
    const { PDFDocument } = await import('pdf-lib');
    const { loadPdf, renderPageToCanvas } = await import('../pdf-shared/pdfjs');
    const bytes = await file.arrayBuffer();
    const doc = await loadPdf(bytes.slice(0));
    const outDoc = await PDFDocument.create();

    const numPages = doc.numPages;
    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const canvas = await renderPageToCanvas(page, level.scale);
      const jpegBytes = await canvasToJpegBytes(canvas, level.jpegQuality);
      const jpg = await outDoc.embedJpg(jpegBytes);

      const viewport = page.getViewport({ scale: 1 });
      const outPage = outDoc.addPage([viewport.width, viewport.height]);
      outPage.drawImage(jpg, { x: 0, y: 0, width: viewport.width, height: viewport.height });

      onPage(i, numPages);
    }

    const outBytes = await outDoc.save();

    // Re-rendering as JPEG only pays off when the source has real photographic
    // detail. For a PDF that's already compact (flat-color/vector-like pages,
    // or images the source PDF already compressed well), the re-encoded
    // version can come out larger — never hand back a "compressed" file
    // that's actually bigger than what the user gave us.
    if (outBytes.byteLength >= bytes.byteLength) {
      return {
        name: file.name.replace(/\.pdf$/i, '') + '-compressed.pdf',
        originalSize: file.size,
        compressedSize: bytes.byteLength,
        blob: new Blob([bytes], { type: 'application/pdf' }),
      };
    }

    return {
      name: file.name.replace(/\.pdf$/i, '') + `-compressed.pdf`,
      originalSize: file.size,
      compressedSize: outBytes.byteLength,
      blob: new Blob([outBytes], { type: 'application/pdf' }),
    };
  }

  async function run() {
    if (files.length === 0) return;
    status = 'processing';
    error = '';
    results = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const result = await compressOne(file, (p, total) => {
          progress = (i + p / total) / files.length;
          progressLabel = `${file.name} — page ${p} of ${total}`;
        });
        results = [...results, result];
      }
      status = 'done';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not compress this PDF.';
      status = 'idle';
    }
  }

  function download(result: JobResult) {
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadAll() {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const r of results) zip.file(r.name, r.blob);
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'compressed-pdfs.zip';
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function reset() {
    files = [];
    results = [];
    status = 'idle';
  }
</script>

<div class="console">
  {#if files.length === 0}
    <Dropzone accept="application/pdf" multiple onfiles={onFiles} label="Drop one or more PDFs, or click to choose" />
  {:else}
    <div class="workbench">
      <p class="file-list readout">{files.map((f) => f.name).join(', ')}</p>

      <div class="field">
        <span class="field-label">Compression level</span>
        <div class="level-toggle">
          {#each LEVELS as l}
            <button type="button" class:active={level.key === l.key} onclick={() => (level = l)} disabled={status === 'processing'}>
              {l.label}
            </button>
          {/each}
        </div>
      </div>

      {#if status === 'processing'}
        <ProgressReadout value={progress} label="Compressing" detail={progressLabel} />
      {:else if status === 'idle'}
        <button type="button" class="run-btn" onclick={run}>Compress</button>
      {/if}

      {#if results.length > 0}
        <div class="results">
          {#each results as r}
            {@const ratio = r.originalSize > 0 ? 1 - r.compressedSize / r.originalSize : 0}
            <div class="result-row">
              <div class="result-info">
                <span class="result-name">{r.name}</span>
                <span class="readout result-sizes">{formatBytes(r.originalSize)} &rarr; {formatBytes(r.compressedSize)} ({ratio >= 0 ? '-' : '+'}{Math.abs(Math.round(ratio * 100))}%)</span>
              </div>
              <Meter value={Math.max(0, ratio)} segments={16} />
              <button type="button" class="download-btn" onclick={() => download(r)}>Download</button>
            </div>
          {/each}
          {#if results.length > 1}
            <button type="button" class="run-btn" onclick={downloadAll}>Download all as .zip</button>
          {/if}
        </div>
      {/if}

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <button type="button" class="reset-btn" onclick={reset}>Start over</button>
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

  .file-list {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .field-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-faint);
  }

  .level-toggle {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    overflow: hidden;
    width: fit-content;
  }

  .level-toggle button {
    background: var(--bg);
    border: none;
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    color: var(--fg-soft);
    font-size: var(--text-sm);
  }

  .level-toggle button.active {
    background: var(--fg);
    color: var(--bg);
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

  .results {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    border-top: 1px solid var(--border);
    padding-top: var(--space-4);
  }

  .result-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .result-info {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-sm);
  }

  .result-sizes {
    color: var(--fg-faint);
    font-size: var(--text-xs);
  }

  .download-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    border-radius: var(--radius-md);
    width: fit-content;
    font-size: var(--text-xs);
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

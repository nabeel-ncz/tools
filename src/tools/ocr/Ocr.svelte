<script lang="ts">
  import { onDestroy } from 'svelte';
  import Dropzone from '../../design/primitives/Dropzone.svelte';
  import ProgressReadout from '../../design/primitives/ProgressReadout.svelte';
  import Led from '../../design/primitives/Led.svelte';
  import type { Worker as TesseractWorker } from 'tesseract.js';

  type Status = 'idle' | 'loading-worker' | 'processing' | 'done' | 'error';
  type Kind = 'image' | 'pdf' | '';

  interface LanguageOption {
    code: string;
    label: string;
  }

  const LANGUAGES: LanguageOption[] = [
    { code: 'eng', label: 'English' },
    { code: 'mal', label: 'Malayalam' },
    { code: 'hin', label: 'Hindi' },
    { code: 'tam', label: 'Tamil' },
  ];

  let status = $state<Status>('idle');
  let errorMessage = $state('');
  let fileName = $state('');
  let fileKind = $state<Kind>('');
  let selectedLangs = $state<string[]>(['eng']);
  let text = $state('');
  let pageCurrent = $state(0);
  let pageTotal = $state(0);
  let recognizeProgress = $state(0);
  let lastFile: File | null = null;

  let worker: TesseractWorker | null = null;
  let workerLangs = '';

  const langLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

  function toggleLang(code: string) {
    if (status === 'loading-worker' || status === 'processing') return;
    if (selectedLangs.includes(code)) {
      if (selectedLangs.length === 1) return; // keep at least one language selected
      selectedLangs = selectedLangs.filter((c) => c !== code);
    } else {
      selectedLangs = [...selectedLangs, code];
    }
  }

  function describeError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) {
      return 'Could not download the language data. Check your connection and try again.';
    }
    if (/pdf/i.test(msg) && /invalid|password|corrupt/i.test(msg)) {
      return 'This PDF could not be read — it may be encrypted or corrupted.';
    }
    return `Recognition failed: ${msg}`;
  }

  async function getWorker(): Promise<TesseractWorker> {
    const joined = selectedLangs.join('+');
    if (worker && workerLangs === joined) return worker;
    if (worker) {
      await worker.terminate();
      worker = null;
    }
    status = 'loading-worker';
    recognizeProgress = 0;
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker(joined, undefined, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') {
          recognizeProgress = m.progress;
        }
      },
    });
    workerLangs = joined;
    return worker;
  }

  async function runImage(file: File) {
    const w = await getWorker();
    status = 'processing';
    pageCurrent = 1;
    pageTotal = 1;
    recognizeProgress = 0;
    const { data } = await w.recognize(file);
    text = data.text;
  }

  async function runPdf(file: File) {
    const pdfjsLib = await import('pdfjs-dist');
    const workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const w = await getWorker();
    status = 'processing';

    const total = doc.numPages;
    pageTotal = total;
    const parts: string[] = [];

    for (let pageNum = 1; pageNum <= total; pageNum++) {
      pageCurrent = pageNum;
      recognizeProgress = 0;
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const renderTask = page.render({ canvas, viewport });
      await renderTask.promise;
      const { data } = await w.recognize(canvas);
      parts.push(data.text.trim());
      page.cleanup();
    }

    text = parts.join('\n\n--- Page break ---\n\n');
  }

  async function handleFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    lastFile = file;
    text = '';
    errorMessage = '';
    fileName = file.name;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    fileKind = isPdf ? 'pdf' : 'image';
    status = 'processing';
    try {
      if (isPdf) {
        await runPdf(file);
      } else {
        await runImage(file);
      }
      status = 'done';
    } catch (err) {
      status = 'error';
      errorMessage = describeError(err);
      console.error(err);
    }
  }

  function retry() {
    if (lastFile) handleFiles([lastFile]);
  }

  function reset() {
    fileName = '';
    fileKind = '';
    text = '';
    errorMessage = '';
    lastFile = null;
    status = 'idle';
    pageCurrent = 0;
    pageTotal = 0;
    recognizeProgress = 0;
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error(err);
    }
  }

  function downloadTxt() {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base = fileName.replace(/\.[^.]+$/, '') || 'ocr-text';
    a.download = `${base}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  onDestroy(() => {
    if (worker) {
      worker.terminate().catch(() => {});
    }
  });
</script>

<div class="console">
  <div class="lang-picker" role="group" aria-label="OCR language">
    {#each LANGUAGES as lang (lang.code)}
      <label class="lang-chip" class:checked={selectedLangs.includes(lang.code)}>
        <input
          type="checkbox"
          checked={selectedLangs.includes(lang.code)}
          onchange={() => toggleLang(lang.code)}
          disabled={status === 'loading-worker' || status === 'processing'}
        />
        {lang.label}
      </label>
    {/each}
  </div>

  {#if status === 'idle' || (status === 'error' && !fileName)}
    <Dropzone
      accept="image/*,application/pdf"
      label="Drop an image or PDF, or click to choose"
      hint="PNG, JPG, WebP, or a scanned PDF"
      onfiles={handleFiles}
    />
    {#if status === 'error'}
      <p class="error-msg">{errorMessage}</p>
    {/if}
  {:else}
    <div class="file-head">
      <div>
        <p class="file-name">{fileName}</p>
        <p class="readout file-meta">
          {fileKind === 'pdf' ? 'PDF' : 'Image'} · languages: {selectedLangs.map(langLabel).join(' + ')}
        </p>
      </div>
      <button type="button" class="ghost-btn" onclick={reset}>Choose a different file</button>
    </div>

    {#if status === 'loading-worker'}
      <div class="progress-block">
        <Led state="live" label="Loading language data" />
        <ProgressReadout label="Preparing Tesseract" indeterminate detail={selectedLangs.join('+')} />
      </div>
    {:else if status === 'processing'}
      <div class="progress-block">
        <Led state="live" label="Recognizing" />
        <ProgressReadout
          label={pageTotal > 1 ? `Page ${pageCurrent} of ${pageTotal}` : 'Recognizing text'}
          value={recognizeProgress}
          detail={`${Math.round(recognizeProgress * 100)}%`}
        />
      </div>
    {/if}

    {#if status === 'error'}
      <p class="error-msg">
        {errorMessage}
        <button type="button" class="ghost-btn" onclick={retry}>Retry</button>
      </p>
    {/if}

    {#if status === 'done'}
      <div class="result">
        <div class="result-head">
          <Led state="ready" label="Done" />
          <div class="export-buttons">
            <button type="button" class="ghost-btn" onclick={copyText}>Copy to clipboard</button>
            <button type="button" class="ghost-btn" onclick={downloadTxt}>Download .txt</button>
          </div>
        </div>
        <label class="visually-hidden" for="ocr-output">Recognized text</label>
        <textarea id="ocr-output" class="output" bind:value={text} spellcheck="false"></textarea>
      </div>
    {/if}
  {/if}
</div>

<style>
  .console {
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-5);
  }

  .lang-picker {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-bottom: var(--space-4);
  }

  .lang-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-soft);
    cursor: pointer;
    background: var(--bg);
    transition: border-color var(--duration-tick) var(--ease-snap), color var(--duration-tick) var(--ease-snap);
  }

  .lang-chip.checked {
    border-color: var(--signal);
    color: var(--fg);
  }

  .lang-chip input {
    accent-color: var(--signal);
  }

  .error-msg {
    margin: var(--space-3) 0 0;
    color: var(--signal);
    font-size: var(--text-sm);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .file-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
    flex-wrap: wrap;
  }

  .file-name {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 500;
    word-break: break-word;
  }

  .file-meta {
    margin: var(--space-1) 0 0;
    color: var(--fg-faint);
    font-size: var(--text-xs);
  }

  .progress-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: var(--bg);
  }

  .result {
    margin-top: var(--space-2);
  }

  .result-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
    flex-wrap: wrap;
  }

  .export-buttons {
    display: flex;
    gap: var(--space-2);
  }

  .output {
    width: 100%;
    min-height: 280px;
    resize: vertical;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.6;
  }

  .ghost-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--fg);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-xs);
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: border-color var(--duration-tick) var(--ease-snap), color var(--duration-tick) var(--ease-snap);
  }

  .ghost-btn:hover {
    border-color: var(--signal);
    color: var(--signal);
  }

  .ghost-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>

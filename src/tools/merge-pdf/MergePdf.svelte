<script lang="ts">
  import Dropzone from '../../design/primitives/Dropzone.svelte';
  import ProgressReadout from '../../design/primitives/ProgressReadout.svelte';

  interface Item {
    id: string;
    file: File;
  }

  let items = $state<Item[]>([]);
  let status = $state<'idle' | 'merging' | 'done'>('idle');
  let progress = $state(0);
  let resultUrl = $state('');
  let error = $state('');
  let dragIndex = $state<number | null>(null);

  function onFiles(files: File[]) {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    items = [...items, ...pdfs.map((file) => ({ id: `${file.name}-${file.size}-${Math.random()}`, file }))];
    status = 'idle';
    resultUrl = '';
  }

  function remove(id: string) {
    items = items.filter((i) => i.id !== id);
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    items = next;
  }

  function onDragStart(index: number) {
    dragIndex = index;
  }
  function onDragOver(e: DragEvent) {
    e.preventDefault();
  }
  function onDrop(index: number) {
    if (dragIndex === null || dragIndex === index) return;
    const next = [...items];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    items = next;
    dragIndex = null;
  }

  function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function merge() {
    if (items.length < 2) {
      error = 'Add at least two PDFs to merge.';
      return;
    }
    status = 'merging';
    error = '';
    progress = 0;
    try {
      const { PDFDocument } = await import('pdf-lib');
      const outDoc = await PDFDocument.create();
      for (let i = 0; i < items.length; i++) {
        const bytes = await items[i].file.arrayBuffer();
        const srcDoc = await PDFDocument.load(bytes);
        const pages = await outDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => outDoc.addPage(p));
        progress = (i + 1) / items.length;
      }
      const outBytes = await outDoc.save();
      const blob = new Blob([outBytes], { type: 'application/pdf' });
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob);
      status = 'done';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not merge these PDFs.';
      status = 'idle';
    }
  }

  function reset() {
    items = [];
    status = 'idle';
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = '';
  }
</script>

<div class="console">
  <Dropzone accept="application/pdf" multiple onfiles={onFiles} label="Drop PDFs to add them to the tray" />

  {#if items.length > 0}
    <ul class="tray">
      {#each items as item, i (item.id)}
        <li
          class="tray-item"
          draggable="true"
          ondragstart={() => onDragStart(i)}
          ondragover={onDragOver}
          ondrop={() => onDrop(i)}
        >
          <span class="tray-serial readout">{String(i + 1).padStart(2, '0')}</span>
          <span class="tray-name">{item.file.name}</span>
          <span class="readout tray-size">{formatBytes(item.file.size)}</span>
          <div class="tray-actions">
            <button type="button" aria-label="Move up" onclick={() => move(i, -1)} disabled={i === 0}>&#8593;</button>
            <button type="button" aria-label="Move down" onclick={() => move(i, 1)} disabled={i === items.length - 1}>&#8595;</button>
            <button type="button" aria-label="Remove" class="remove" onclick={() => remove(item.id)}>&times;</button>
          </div>
        </li>
      {/each}
    </ul>

    {#if status === 'merging'}
      <ProgressReadout value={progress} label="Merging" />
    {:else if status === 'done' && resultUrl}
      <a class="download-btn" href={resultUrl} download="merged.pdf">Download merged.pdf</a>
    {:else}
      <button type="button" class="run-btn" onclick={merge}>Merge {items.length} PDFs</button>
    {/if}

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <button type="button" class="reset-btn" onclick={reset}>Clear tray</button>
  {/if}
</div>

<style>
  .console {
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .tray {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--border);
  }

  .tray-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-2);
    border-bottom: 1px solid var(--border);
    cursor: grab;
  }

  .tray-serial {
    color: var(--fg-faint);
    font-size: var(--text-xs);
    width: 2em;
  }

  .tray-name {
    flex: 1;
    font-size: var(--text-sm);
  }

  .tray-size {
    color: var(--fg-faint);
    font-size: var(--text-xs);
  }

  .tray-actions {
    display: flex;
    gap: var(--space-1);
  }

  .tray-actions button {
    background: var(--bg);
    border: 1px solid var(--border);
    width: 26px;
    height: 26px;
    cursor: pointer;
    color: var(--fg-soft);
    border-radius: var(--radius-sm);
  }

  .tray-actions button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .tray-actions .remove:hover {
    border-color: var(--signal);
    color: var(--signal);
  }

  .run-btn,
  .download-btn {
    background: var(--signal);
    color: #fff;
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
    color: var(--signal);
    font-size: var(--text-sm);
  }
</style>

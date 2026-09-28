<script lang="ts">
  interface Props {
    accept?: string;
    multiple?: boolean;
    label?: string;
    hint?: string;
    onfiles?: (files: File[]) => void;
    disabled?: boolean;
  }
  let {
    accept = '',
    multiple = false,
    label = 'Drop a file here, or click to choose',
    hint = '',
    onfiles,
    disabled = false,
  }: Props = $props();

  let dragging = $state(false);
  let inputEl: HTMLInputElement;

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    onfiles?.(Array.from(fileList));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (disabled) return;
    handleFiles(e.dataTransfer?.files ?? null);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    if (!disabled) dragging = true;
  }

  function onDragLeave() {
    dragging = false;
  }

  function onClick() {
    if (!disabled) inputEl.click();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  }
</script>

<div
  class="dropzone"
  class:dragging
  class:disabled
  role="button"
  tabindex={disabled ? -1 : 0}
  aria-disabled={disabled}
  ondrop={onDrop}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  onclick={onClick}
  onkeydown={onKeydown}
>
  <input
    bind:this={inputEl}
    type="file"
    class="visually-hidden"
    {accept}
    {multiple}
    {disabled}
    onchange={(e) => handleFiles((e.target as HTMLInputElement).files)}
  />
  <svg class="dz-icon" width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
    <path d="M14 4v14M14 4l-5 5M14 4l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
    <path d="M4 20v3h20v-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
  </svg>
  <p class="dz-label">{label}</p>
  {#if hint}<p class="dz-hint readout">{hint}</p>{/if}
</div>

<style>
  .dropzone {
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md);
    padding: var(--space-8) var(--space-5);
    text-align: center;
    cursor: pointer;
    background: var(--bg-raised);
    transition:
      border-color var(--duration-tick) var(--ease-snap),
      background var(--duration-tick) var(--ease-snap);
    color: var(--fg-soft);
  }

  .dropzone.dragging {
    border-color: var(--signal);
    background: color-mix(in srgb, var(--signal) 6%, var(--bg-raised));
    color: var(--fg);
  }

  .dropzone.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .dz-icon {
    color: var(--fg-faint);
    margin-bottom: var(--space-3);
  }

  .dz-label {
    margin: 0;
    font-size: var(--text-sm);
    color: inherit;
  }

  .dz-hint {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }
</style>

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
</script>

<!--
  A single native <label> wraps the (visually-hidden but still focusable and
  keyboard-operable) file input, instead of a separate role="button" element
  with its own click/keydown handlers. That earlier pattern put two
  interactive controls in the accessibility tree, one nested inside the
  other (axe-core: "nested-interactive", serious impact) — a <label>
  wrapping its control is the standard, natively accessible way to give a
  form control a larger click target: clicking anywhere in the label
  activates the input (and does nothing when the input is disabled) with no
  extra JS, and the input's own native keyboard behavior (Tab to focus,
  Enter/Space to open the file picker) already covers keyboard use.
-->
<label class="dropzone" class:dragging class:disabled ondrop={onDrop} ondragover={onDragOver} ondragleave={onDragLeave}>
  <input
    bind:this={inputEl}
    type="file"
    class="visually-hidden"
    aria-label={label}
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
</label>

<style>
  .dropzone {
    display: block;
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
    border-color: var(--signal-text);
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

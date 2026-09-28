<script lang="ts">
  // Draggable before/after comparison. Duplicated (not shared) in
  // src/tools/image-upscaler/SplitLens.svelte — see that tool's copy for context.
  interface Props {
    beforeSrc: string;
    afterSrc: string;
    beforeLabel?: string;
    afterLabel?: string;
    checkered?: boolean;
    aspectRatio?: number; // width / height
  }
  let { beforeSrc, afterSrc, beforeLabel = 'Before', afterLabel = 'After', checkered = false, aspectRatio = 4 / 3 }: Props = $props();

  let position = $state(50); // percent across the frame, 0..100
  let containerEl: HTMLDivElement;
  let dragging = $state(false);

  function setFromClientX(clientX: number) {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    position = Math.max(0, Math.min(100, pct));
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    containerEl.setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    setFromClientX(e.clientX);
  }
  function onPointerUp() {
    dragging = false;
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') {
      position = Math.max(0, position - 2);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      position = Math.min(100, position + 2);
      e.preventDefault();
    } else if (e.key === 'Home') {
      position = 0;
      e.preventDefault();
    } else if (e.key === 'End') {
      position = 100;
      e.preventDefault();
    }
  }
</script>

<div
  class="split-lens"
  class:checkered
  class:dragging
  bind:this={containerEl}
  style={`aspect-ratio:${aspectRatio}`}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  <img class="layer layer-before" src={beforeSrc} alt={beforeLabel} draggable="false" />
  <div class="layer layer-after" style={`clip-path: inset(0 ${100 - position}% 0 0)`}>
    <img src={afterSrc} alt={afterLabel} draggable="false" />
  </div>
  <div class="rail" style={`left:${position}%`}>
    <div
      class="handle"
      role="slider"
      tabindex="0"
      aria-label="Before/after comparison position"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(position)}
      onkeydown={onKeydown}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4 2L1 6l3 4M8 2l3 4-3 4" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linecap="square" />
      </svg>
    </div>
  </div>
  <span class="tag tag-before readout">{beforeLabel}</span>
  <span class="tag tag-after readout">{afterLabel}</span>
</div>

<style>
  .split-lens {
    position: relative;
    width: 100%;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    cursor: ew-resize;
    user-select: none;
    touch-action: none;
  }

  .split-lens.checkered {
    background: repeating-conic-gradient(#ccc 0% 25%, #eee 0% 50%) 0 0 / 16px 16px;
  }

  .layer {
    position: absolute;
    inset: 0;
  }

  .layer img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .rail {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--border-strong);
    transform: translateX(-50%);
    transition: background var(--duration-tick) var(--ease-snap);
  }

  .split-lens.dragging .rail {
    background: var(--signal);
  }

  .handle {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--fg-soft);
    transition:
      border-color var(--duration-tick) var(--ease-snap),
      color var(--duration-tick) var(--ease-snap);
  }

  .split-lens.dragging .handle,
  .handle:focus-visible {
    border-color: var(--signal);
    color: var(--signal);
    outline: none;
  }

  .tag {
    position: absolute;
    top: var(--space-2);
    font-size: var(--text-xs);
    background: rgba(12, 12, 11, 0.65);
    color: var(--color-paper);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    pointer-events: none;
  }

  .tag-before {
    left: var(--space-2);
  }

  .tag-after {
    right: var(--space-2);
  }
</style>

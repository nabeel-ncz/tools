<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    format?: (v: number) => string;
    onchange?: (v: number) => void;
  }
  let { label, value = $bindable(), min = 0, max = 100, step = 1, unit = '', format, onchange }: Props = $props();

  let angle = $derived(((value - min) / (max - min)) * 270 - 135);
  let display = $derived(format ? format(value) : `${value}${unit}`);

  function clamp(v: number) {
    return Math.min(max, Math.max(min, v));
  }

  function set(v: number) {
    value = clamp(Math.round(v / step) * step);
    onchange?.(value);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      set(value + step);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      set(value - step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      set(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      set(max);
    }
  }

  let dragging = false;
  function onPointerDown(e: PointerEvent) {
    dragging = true;
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const delta = -e.movementY;
    set(value + delta * step * 0.5);
  }
  function onPointerUp(e: PointerEvent) {
    dragging = false;
    (e.target as Element).releasePointerCapture(e.pointerId);
  }
</script>

<div class="dial-wrap">
  <div
    class="dial"
    role="slider"
    tabindex="0"
    aria-label={label}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    aria-valuetext={display}
    onkeydown={onKeydown}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
  >
    <div class="dial-face" style={`transform: rotate(${angle}deg)`}>
      <span class="dial-pointer"></span>
    </div>
  </div>
  <div class="dial-readout">
    <span class="dial-label">{label}</span>
    <span class="readout">{display}</span>
  </div>
</div>

<style>
  .dial-wrap {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    user-select: none;
  }

  .dial {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    position: relative;
    cursor: grab;
    touch-action: none;
  }

  .dial:active {
    cursor: grabbing;
  }

  .dial-face {
    position: absolute;
    inset: 0;
    transition: transform var(--duration-tick) var(--ease-snap);
  }

  .dial-pointer {
    position: absolute;
    top: 6px;
    left: 50%;
    width: 2px;
    height: 14px;
    background: var(--signal);
    transform: translateX(-50%);
  }

  .dial-readout {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    text-align: center;
  }

  .dial-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-faint);
  }

  .readout {
    font-size: var(--text-sm);
  }
</style>

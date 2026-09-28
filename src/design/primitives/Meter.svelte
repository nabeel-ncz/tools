<script lang="ts">
  interface Props {
    value?: number; // 0..1
    label?: string;
    unit?: string;
    segments?: number;
    peak?: boolean;
  }
  let { value = 0, label = '', unit = '', segments = 20, peak = false }: Props = $props();

  let filled = $derived(Math.round(Math.max(0, Math.min(1, value)) * segments));
</script>

<div class="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
  {#if label}
    <div class="meter-head">
      <span class="meter-label">{label}</span>
      <span class="readout">{Math.round(value * 100)}{unit || '%'}</span>
    </div>
  {/if}
  <div class="meter-bar">
    {#each Array(segments) as _, i}
      <span
        class="seg"
        class:on={i < filled}
        class:hot={peak && i >= segments - 3}
      ></span>
    {/each}
  </div>
</div>

<style>
  .meter {
    display: block;
  }

  .meter-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: var(--space-2);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-faint);
  }

  .meter-bar {
    display: grid;
    grid-auto-flow: column;
    gap: 2px;
    height: 14px;
  }

  .seg {
    background: var(--border);
    border-radius: 1px;
    transition: background var(--duration-tick) var(--ease-snap);
  }

  .seg.on {
    background: var(--fg-soft);
  }

  .seg.on.hot {
    background: var(--signal);
  }
</style>

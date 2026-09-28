<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    ticks?: string[];
    format?: (v: number) => string;
    onchange?: (v: number) => void;
    id?: string;
  }
  let {
    label,
    value = $bindable(),
    min = 0,
    max = 100,
    step = 1,
    ticks,
    format,
    onchange,
    id,
  }: Props = $props();

  let display = $derived(format ? format(value) : String(value));
  let inputId = id ?? `slider-${label.replace(/\s+/g, '-').toLowerCase()}`;

  function onInput(e: Event) {
    value = Number((e.target as HTMLInputElement).value);
    onchange?.(value);
  }
</script>

<div class="slider-field">
  <div class="slider-head">
    <label for={inputId}>{label}</label>
    <span class="readout">{display}</span>
  </div>
  <input
    id={inputId}
    type="range"
    {min}
    {max}
    {step}
    {value}
    oninput={onInput}
    list={ticks ? `${inputId}-ticks` : undefined}
  />
  {#if ticks}
    <datalist id={`${inputId}-ticks`}>
      {#each ticks as t}<option value={t}></option>{/each}
    </datalist>
    <div class="tick-labels">
      {#each ticks as t}<span>{t}</span>{/each}
    </div>
  {/if}
</div>

<style>
  .slider-field {
    display: block;
    width: 100%;
  }

  .slider-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: var(--space-2);
  }

  label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-faint);
  }

  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 2px;
    background: var(--border-strong);
    outline: none;
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 2px;
    background: var(--fg);
    border: 2px solid var(--bg);
    box-shadow: 0 0 0 1px var(--border-strong);
    cursor: pointer;
    transition: transform var(--duration-tick) var(--ease-snap);
  }

  input[type='range']:active::-webkit-slider-thumb {
    transform: scale(1.15);
    background: var(--signal);
  }

  input[type='range']::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 2px;
    background: var(--fg);
    border: 2px solid var(--bg);
    box-shadow: 0 0 0 1px var(--border-strong);
    cursor: pointer;
  }

  .tick-labels {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-1);
    font-size: var(--text-xs);
    color: var(--fg-faint);
    font-family: var(--font-mono);
  }
</style>

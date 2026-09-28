<script lang="ts">
  interface Props {
    value?: number; // 0..1
    label?: string;
    detail?: string;
    indeterminate?: boolean;
  }
  let { value = 0, label = '', detail = '', indeterminate = false }: Props = $props();
</script>

<div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : Math.round(value * 100)} aria-label={label}>
  <div class="progress-head">
    {#if label}<span class="p-label">{label}</span>{/if}
    {#if detail}<span class="readout p-detail">{detail}</span>{/if}
  </div>
  <div class="progress-track" class:indeterminate>
    <div class="progress-fill" style={indeterminate ? '' : `width:${Math.round(value * 100)}%`}></div>
  </div>
</div>

<style>
  .progress {
    width: 100%;
  }

  .progress-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: var(--space-2);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-faint);
  }

  .progress-track {
    height: 3px;
    background: var(--border);
    position: relative;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--signal);
    transition: width var(--duration-tick) linear;
  }

  .progress-track.indeterminate .progress-fill {
    position: absolute;
    width: 30% !important;
    animation: sweep 1.1s ease-in-out infinite;
  }

  @keyframes sweep {
    0% {
      left: -30%;
    }
    100% {
      left: 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-track.indeterminate .progress-fill {
      animation: none;
      left: 0;
    }
  }
</style>

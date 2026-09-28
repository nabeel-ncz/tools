<script lang="ts">
  interface Props {
    state?: 'off' | 'ready' | 'live' | 'error';
    label?: string;
  }
  let { state = 'off', label = '' }: Props = $props();
</script>

<span class="led led-{state}" role="status" aria-label={label || state}>
  <span class="dot"></span>
  {#if label}<span class="led-label">{label}</span>{/if}
</span>

<style>
  .led {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-faint);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fg-faint);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
    flex: none;
  }

  .led-ready .dot {
    background: var(--fg-soft);
  }

  .led-live .dot {
    background: var(--signal);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--signal) 25%, transparent);
    animation: pulse 1.1s ease-in-out infinite;
  }

  .led-live {
    color: var(--signal);
  }

  .led-error .dot {
    background: var(--signal);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none !important;
    }
  }
</style>

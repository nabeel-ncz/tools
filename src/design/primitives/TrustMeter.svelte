<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    engineLabel?: string;
  }
  let { engineLabel = '' }: Props = $props();

  let uploadedBytes = $state(0);
  let watching = $state(false);
  let observer: PerformanceObserver | null = null;

  function formatBytes(n: number) {
    if (n === 0) return '0 bytes';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  onMount(() => {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          // Only count request bodies leaving this device — resource fetches
          // (scripts, models, fonts) are downloads, tracked separately by the
          // engine loader. A same-origin non-GET call is the only way this
          // page could send file bytes out; nothing here does that.
          const init = (entry as any).initiatorType;
          if (init === 'xmlhttprequest' || init === 'fetch') {
            uploadedBytes += entry.transferSize || 0;
          }
        }
      });
      observer.observe({ type: 'resource', buffered: false });
      watching = true;
    } catch {
      watching = false;
    }
  });

  onDestroy(() => {
    observer?.disconnect();
  });
</script>

<div class="trust-meter" class:alert={uploadedBytes > 0}>
  <span class="tm-dot" aria-hidden="true"></span>
  <span class="tm-text">
    <span class="tm-key">Uploaded</span>
    <span class="readout tm-value">{formatBytes(uploadedBytes)}</span>
  </span>
  {#if engineLabel}
    <span class="tm-engine readout">{engineLabel}</span>
  {/if}
  {#if !watching}
    <span class="tm-note">(network monitor unsupported in this browser)</span>
  {/if}
</div>

<style>
  .trust-meter {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .trust-meter.alert {
    border-color: var(--signal);
  }

  .tm-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #3a8f5c;
    flex: none;
  }

  .alert .tm-dot {
    background: var(--signal);
  }

  .tm-text {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .tm-key {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }

  .tm-value {
    font-size: var(--text-sm);
  }

  .tm-engine {
    color: var(--fg-faint);
    font-size: var(--text-xs);
    border-left: 1px solid var(--border);
    padding-left: var(--space-3);
  }

  .tm-note {
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }
</style>

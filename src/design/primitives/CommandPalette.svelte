<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface Item {
    title: string;
    serial: string;
    url: string;
    category: string;
    keyword: string;
  }

  interface Props {
    items: Item[];
  }
  let { items }: Props = $props();

  let open = $state(false);
  let query = $state('');
  let activeIndex = $state(0);
  let inputEl: HTMLInputElement;

  let filtered = $derived(
    query.trim() === ''
      ? items
      : items.filter((i) => {
          const q = query.toLowerCase();
          return (
            i.title.toLowerCase().includes(q) ||
            i.keyword.toLowerCase().includes(q) ||
            i.category.toLowerCase().includes(q)
          );
        })
  );

  function openPalette() {
    open = true;
    query = '';
    activeIndex = 0;
    queueMicrotask(() => inputEl?.focus());
  }

  function closePalette() {
    open = false;
  }

  function navigate(url: string) {
    closePalette();
    window.location.href = url;
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open ? closePalette() : openPalette();
      return;
    }

    if (e.key === '/' && !isTyping && !open) {
      e.preventDefault();
      openPalette();
      return;
    }

    if (open && e.key === 'Escape') {
      closePalette();
    }
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) navigate(item.url);
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onGlobalKeydown);
  });
  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onGlobalKeydown);
  });
</script>

<button type="button" class="palette-trigger" onclick={openPalette} aria-label="Open command palette">
  <span>Jump to instrument</span>
  <kbd>⌘K</kbd>
</button>

{#if open}
  <div class="palette-overlay" role="presentation" onclick={closePalette}>
    <div
      class="palette"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onclick={(e) => e.stopPropagation()}
    >
      <input
        bind:this={inputEl}
        type="text"
        placeholder="Search instruments…"
        bind:value={query}
        onkeydown={onInputKeydown}
        aria-label="Search tools"
        autocomplete="off"
      />
      <ul class="palette-list" role="listbox">
        {#each filtered as item, i (item.url)}
          <li>
            <button
              type="button"
              class="palette-item"
              class:active={i === activeIndex}
              onclick={() => navigate(item.url)}
              onmouseenter={() => (activeIndex = i)}
            >
              <span class="p-serial readout">{item.serial}</span>
              <span class="p-title">{item.title}</span>
              <span class="p-category">{item.category}</span>
            </button>
          </li>
        {:else}
          <li class="palette-empty">No instruments match "{query}"</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .palette-trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--fg-soft);
    cursor: pointer;
  }

  .palette-trigger:hover {
    border-color: var(--border-strong);
    color: var(--fg);
  }

  kbd {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 1px 5px;
    background: var(--bg);
  }

  .palette-overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--fg) 40%, transparent);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    z-index: 200;
  }

  .palette {
    width: min(560px, 90vw);
    background: var(--bg);
    border: 1px solid var(--border-strong);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  }

  .palette input {
    width: 100%;
    box-sizing: border-box;
    border: none;
    border-bottom: 1px solid var(--border);
    padding: var(--space-4) var(--space-5);
    font-size: var(--text-md);
    background: transparent;
    color: var(--fg);
  }

  .palette input:focus-visible {
    outline: none;
  }

  .palette-list {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    max-height: 50vh;
    overflow-y: auto;
  }

  .palette-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: var(--space-3) var(--space-3);
    cursor: pointer;
    color: var(--fg);
    border-radius: var(--radius-sm);
  }

  .palette-item.active {
    background: var(--bg-raised);
  }

  .p-serial {
    color: var(--fg-faint);
    font-size: var(--text-xs);
    flex: none;
    width: 3.5em;
  }

  .p-title {
    flex: 1;
    font-family: var(--font-display);
  }

  .p-category {
    color: var(--fg-faint);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  .palette-empty {
    padding: var(--space-5);
    color: var(--fg-faint);
    text-align: center;
  }
</style>

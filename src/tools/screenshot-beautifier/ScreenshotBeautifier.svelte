<script lang="ts">
  import Dropzone from '../../design/primitives/Dropzone.svelte';
  import SteppedSlider from '../../design/primitives/SteppedSlider.svelte';

  interface Preset {
    name: string;
    width: number;
    height: number;
  }

  const PRESETS: Preset[] = [
    { name: 'Original', width: 0, height: 0 },
    { name: 'X / Twitter (1200×675)', width: 1200, height: 675 },
    { name: 'LinkedIn (1200×627)', width: 1200, height: 627 },
    { name: 'Instagram Square (1080×1080)', width: 1080, height: 1080 },
    { name: 'Open Graph (1200×630)', width: 1200, height: 630 },
  ];

  interface Background {
    name: string;
    swatch: string;
    paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  }

  const BACKGROUNDS: Background[] = [
    {
      name: 'Paper',
      swatch: '#F4F1EA',
      paint: (ctx, w, h) => {
        ctx.fillStyle = '#F4F1EA';
        ctx.fillRect(0, 0, w, h);
      },
    },
    {
      name: 'Ink',
      swatch: '#141413',
      paint: (ctx, w, h) => {
        ctx.fillStyle = '#141413';
        ctx.fillRect(0, 0, w, h);
      },
    },
    {
      name: 'Vermilion',
      swatch: '#E4572E',
      paint: (ctx, w, h) => {
        ctx.fillStyle = '#E4572E';
        ctx.fillRect(0, 0, w, h);
      },
    },
    {
      name: 'Dusk',
      swatch: 'linear-gradient(135deg,#2b2b6f,#0f0f1a)',
      paint: (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#2b2b6f');
        g.addColorStop(1, '#0f0f1a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      },
    },
    {
      name: 'Dawn',
      swatch: 'linear-gradient(135deg,#f6b26b,#e4572e)',
      paint: (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#f6b26b');
        g.addColorStop(1, '#e4572e');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      },
    },
    {
      name: 'Slate',
      swatch: 'linear-gradient(135deg,#3a3a37,#141413)',
      paint: (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#3a3a37');
        g.addColorStop(1, '#141413');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      },
    },
  ];

  let sourceImage = $state<HTMLImageElement | null>(null);
  let canvasEl: HTMLCanvasElement;
  let presetIndex = $state(0);
  let bgIndex = $state(0);
  let padding = $state(64);
  let radius = $state(12);
  let shadow = $state(24);
  let format = $state<'png' | 'jpg'>('png');
  let status = $state<'idle' | 'ready'>('idle');

  function onFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      status = 'ready';
      queueMicrotask(render);
    };
    img.src = URL.createObjectURL(file);
  }

  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) onFiles([file]);
      }
    }
  }

  function outputSize(): { w: number; h: number } {
    const preset = PRESETS[presetIndex];
    if (preset.width === 0 && sourceImage) {
      return { w: sourceImage.naturalWidth + padding * 2, h: sourceImage.naturalHeight + padding * 2 };
    }
    return { w: preset.width, h: preset.height };
  }

  function render() {
    if (!sourceImage || !canvasEl) return;
    const { w, h } = outputSize();
    canvasEl.width = w;
    canvasEl.height = h;
    const ctx = canvasEl.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    BACKGROUNDS[bgIndex].paint(ctx, w, h);

    const maxW = w - padding * 2;
    const maxH = h - padding * 2;
    const scale = Math.min(maxW / sourceImage.naturalWidth, maxH / sourceImage.naturalHeight, 1);
    const drawW = sourceImage.naturalWidth * scale;
    const drawH = sourceImage.naturalHeight * scale;
    const x = (w - drawW) / 2;
    const y = (h - drawH) / 2;

    ctx.save();
    if (shadow > 0) {
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = shadow;
      ctx.shadowOffsetY = shadow * 0.3;
    }
    roundedRectPath(ctx, x, y, drawW, drawH, radius);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundedRectPath(ctx, x, y, drawW, drawH, radius);
    ctx.clip();
    ctx.drawImage(sourceImage, x, y, drawW, drawH);
    ctx.restore();
  }

  function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  $effect(() => {
    void [presetIndex, bgIndex, padding, radius, shadow, sourceImage];
    render();
  });

  function download() {
    if (!canvasEl) return;
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    canvasEl.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `screenshot.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      },
      mime,
      0.92
    );
  }
</script>

<svelte:window onpaste={onPaste} />

<div class="console">
  {#if status === 'idle'}
    <Dropzone accept="image/*" onfiles={onFiles} label="Drop a screenshot, or paste with Ctrl/Cmd+V" />
  {:else}
    <div class="stage-layout">
      <div class="stage">
        <canvas bind:this={canvasEl}></canvas>
      </div>
      <div class="side-controls">
        <div class="field">
          <span class="field-label">Background</span>
          <div class="swatches">
            {#each BACKGROUNDS as bg, i}
              <button
                type="button"
                class="swatch"
                class:active={i === bgIndex}
                style={`background:${bg.swatch}`}
                aria-label={bg.name}
                onclick={() => (bgIndex = i)}
              ></button>
            {/each}
          </div>
        </div>

        <SteppedSlider label="Padding" bind:value={padding} min={0} max={200} step={4} format={(v) => `${v}px`} />
        <SteppedSlider label="Corner radius" bind:value={radius} min={0} max={48} step={2} format={(v) => `${v}px`} />
        <SteppedSlider label="Shadow" bind:value={shadow} min={0} max={80} step={2} format={(v) => `${v}px`} />

        <div class="field">
          <span class="field-label">Export size</span>
          <select bind:value={presetIndex}>
            {#each PRESETS as preset, i}
              <option value={i}>{preset.name}</option>
            {/each}
          </select>
        </div>

        <div class="field">
          <span class="field-label">Format</span>
          <div class="format-toggle">
            <button type="button" class:active={format === 'png'} onclick={() => (format = 'png')}>PNG</button>
            <button type="button" class:active={format === 'jpg'} onclick={() => (format = 'jpg')}>JPG</button>
          </div>
        </div>

        <button type="button" class="export-btn" onclick={download}>Export image</button>
        <button
          type="button"
          class="reset-btn"
          onclick={() => {
            sourceImage = null;
            status = 'idle';
          }}>Choose a different image</button
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .console {
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-5);
  }

  .stage-layout {
    display: grid;
    grid-template-columns: 1fr 260px;
    gap: var(--space-5);
  }

  .stage {
    background: repeating-conic-gradient(#ccc 0% 25%, #eee 0% 50%) 0 0 / 16px 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    border: 1px solid var(--border);
    min-height: 300px;
  }

  canvas {
    max-width: 100%;
    max-height: 60vh;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .side-controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .field-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-faint);
  }

  .swatches {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .swatch {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    border: 2px solid transparent;
    cursor: pointer;
  }

  .swatch.active {
    border-color: var(--signal);
  }

  select {
    background: var(--bg);
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
  }

  .format-toggle {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    overflow: hidden;
    width: fit-content;
  }

  .format-toggle button {
    background: var(--bg);
    border: none;
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    color: var(--fg-soft);
  }

  .format-toggle button.active {
    background: var(--fg);
    color: var(--bg);
  }

  .export-btn {
    background: var(--signal);
    color: #fff;
    border: none;
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .reset-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg-soft);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  @media (max-width: 800px) {
    .stage-layout {
      grid-template-columns: 1fr;
    }
  }
</style>

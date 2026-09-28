<script lang="ts">
  import Dropzone from '../../design/primitives/Dropzone.svelte';
  import ProgressReadout from '../../design/primitives/ProgressReadout.svelte';
  import { buildIco } from './ico';

  interface SizeSpec {
    size: number;
    name: string;
    maskable?: boolean;
  }

  const SIZES: SizeSpec[] = [
    { size: 16, name: 'favicon-16x16.png' },
    { size: 32, name: 'favicon-32x32.png' },
    { size: 48, name: 'favicon-48x48.png' },
    { size: 180, name: 'apple-touch-icon.png' },
    { size: 192, name: 'android-chrome-192x192.png' },
    { size: 512, name: 'android-chrome-512x512.png' },
    { size: 512, name: 'maskable-icon-512x512.png', maskable: true },
  ];

  let sourceImage = $state<HTMLImageElement | null>(null);
  let previewUrl = $state('');
  let status = $state<'idle' | 'ready' | 'generating' | 'done'>('idle');
  let progress = $state(0);
  let error = $state('');
  let zipUrl = $state('');
  let zipName = $state('icons.zip');

  function drawToCanvas(size: number, maskable = false): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    if (!sourceImage) return canvas;

    const srcSize = Math.min(sourceImage.naturalWidth, sourceImage.naturalHeight);
    const sx = (sourceImage.naturalWidth - srcSize) / 2;
    const sy = (sourceImage.naturalHeight - srcSize) / 2;

    if (maskable) {
      ctx.fillStyle = '#141413';
      ctx.fillRect(0, 0, size, size);
      const pad = size * 0.1;
      const inner = size - pad * 2;
      ctx.drawImage(sourceImage, sx, sy, srcSize, srcSize, pad, pad, inner, inner);
    } else {
      ctx.drawImage(sourceImage, sx, sy, srcSize, srcSize, 0, 0, size, size);
    }
    return canvas;
  }

  function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('Could not encode PNG'));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/png');
    });
  }

  function onFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    error = '';
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      previewUrl = img.src;
      status = 'ready';
    };
    img.onerror = () => {
      error = 'Could not read that image file.';
    };
    img.src = URL.createObjectURL(file);
  }

  async function generate() {
    if (!sourceImage) return;
    status = 'generating';
    progress = 0;
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();

    const pngResults: { size: number; name: string; bytes: Uint8Array }[] = [];

    for (let i = 0; i < SIZES.length; i++) {
      const spec = SIZES[i];
      const canvas = drawToCanvas(spec.size, spec.maskable);
      const bytes = await canvasToPngBytes(canvas);
      pngResults.push({ size: spec.size, name: spec.name, bytes });
      zip.file(spec.name, bytes);
      progress = (i + 1) / (SIZES.length + 2);
    }

    const icoSources = pngResults.filter((p) => [16, 32, 48].includes(p.size) && !p.name.includes('android') && !p.name.includes('maskable'));
    const icoBytes = buildIco(icoSources.map((p) => ({ size: p.size, bytes: p.bytes })));
    zip.file('favicon.ico', icoBytes);
    progress = (SIZES.length + 1) / (SIZES.length + 2);

    const manifest = {
      name: 'Your App',
      short_name: 'App',
      icons: [
        { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      theme_color: '#ffffff',
      background_color: '#ffffff',
      display: 'standalone',
    };
    zip.file('site.webmanifest', JSON.stringify(manifest, null, 2));

    const snippet = `<link rel="icon" type="image/x-icon" href="/favicon.ico" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#ffffff" />`;
    zip.file('head-snippet.html', snippet);

    const blob = await zip.generateAsync({ type: 'blob' });
    if (zipUrl) URL.revokeObjectURL(zipUrl);
    zipUrl = URL.createObjectURL(blob);
    progress = 1;
    status = 'done';
  }

  function reset() {
    sourceImage = null;
    previewUrl = '';
    status = 'idle';
    if (zipUrl) URL.revokeObjectURL(zipUrl);
    zipUrl = '';
  }
</script>

<div class="console">
  {#if status === 'idle'}
    <Dropzone accept="image/*" onfiles={onFiles} label="Drop a square image, or click to choose" hint="512×512px or larger recommended" />
  {:else}
    <div class="workbench">
      <div class="preview-strip">
        {#each [16, 32, 48, 180] as size}
          <div class="preview-cell">
            <img src={previewUrl} alt={`Preview at ${size}px`} style={`width:${Math.min(size, 96)}px;height:${Math.min(size, 96)}px`} />
            <span class="readout">{size}px</span>
          </div>
        {/each}
      </div>

      {#if status === 'generating'}
        <ProgressReadout value={progress} label="Generating icon set" detail={`${Math.round(progress * 100)}%`} />
      {:else if status === 'done'}
        <div class="done-panel">
          <p>Your icon set is ready — {SIZES.length + 2} files including favicon.ico, the manifest, and a paste-in HTML snippet.</p>
          <a class="download-btn" href={zipUrl} download={zipName}>Download icons.zip</a>
        </div>
      {:else}
        <button type="button" class="generate-btn" onclick={generate}>Generate icon set</button>
      {/if}

      <button type="button" class="reset-btn" onclick={reset}>Choose a different image</button>
    </div>
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {/if}
</div>

<style>
  .console {
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-6);
  }

  .workbench {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .preview-strip {
    display: flex;
    align-items: flex-end;
    gap: var(--space-5);
    padding: var(--space-4);
    background: var(--bg);
    border: 1px solid var(--border);
  }

  .preview-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  .preview-cell img {
    background: repeating-conic-gradient(#ccc 0% 25%, #eee 0% 50%) 0 0 / 12px 12px;
    border: 1px solid var(--border);
    object-fit: cover;
  }

  .preview-cell .readout {
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }

  .generate-btn,
  .download-btn {
    display: inline-block;
    background: var(--signal);
    color: var(--color-ink);
    border: none;
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    cursor: pointer;
    text-decoration: none;
    text-align: center;
    border-radius: var(--radius-md);
    width: fit-content;
  }

  .done-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .done-panel p {
    margin: 0;
    font-size: var(--text-sm);
  }

  .reset-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg-soft);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    border-radius: var(--radius-md);
    width: fit-content;
  }

  .error {
    color: var(--signal-text);
    font-size: var(--text-sm);
  }
</style>

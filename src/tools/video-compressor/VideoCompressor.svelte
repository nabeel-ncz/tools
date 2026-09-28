<script lang="ts">
  // NOTE ON VERIFICATION: the ffmpeg.wasm load + writeFile/exec/readFile path
  // below is built against the documented @ffmpeg/ffmpeg v0.12 API (see
  // ffmpegEngine.ts) and the installed package's own type declarations, but
  // this sandbox has no way to drive a real Chrome tab and run an actual
  // ffmpeg.wasm transcode end-to-end. It has not been exercised live; it is
  // code-correct against the docs, and `npx astro build` succeeds with it.
  import { onDestroy } from 'svelte';
  import Dropzone from '../../design/primitives/Dropzone.svelte';
  import SteppedSlider from '../../design/primitives/SteppedSlider.svelte';
  import Dial from '../../design/primitives/Dial.svelte';
  import ProgressReadout from '../../design/primitives/ProgressReadout.svelte';
  import { loadEngine } from './ffmpegEngine';
  import type { FFmpeg } from '@ffmpeg/ffmpeg';

  type Status = 'idle' | 'ready' | 'loading-engine' | 'exporting' | 'done' | 'error';
  type OutputFormat = 'mp4' | 'webm' | 'gif';

  let status = $state<Status>('idle');
  let errorMessage = $state('');

  let file = $state<File | null>(null);
  let videoUrl = $state('');
  let duration = $state(0);
  let inPoint = $state(0);
  let outPoint = $state(0);

  let crf = $state(28);
  let outputFormat = $state<OutputFormat>('mp4');

  let progress = $state(0);
  let progressDetail = $state('');

  let outputUrl = $state('');
  let outputSize = $state(0);

  let hiddenVideoEl: HTMLVideoElement;
  let ffmpegRef: FFmpeg | null = null;
  let progressHandler: ((e: { progress: number; time: number }) => void) | null = null;

  function formatTime(sec: number) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }

  function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function onFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    reset(false);
    file = f;
    videoUrl = URL.createObjectURL(f);
    status = 'ready';
  }

  function onLoadedMetadata() {
    if (!hiddenVideoEl) return;
    duration = hiddenVideoEl.duration || 0;
    inPoint = 0;
    outPoint = duration;
  }

  function onInPointChange(v: number) {
    if (v >= outPoint) inPoint = Math.max(0, outPoint - 0.1);
  }

  function onOutPointChange(v: number) {
    if (v <= inPoint) outPoint = Math.min(duration, inPoint + 0.1);
  }

  function extOf(name: string) {
    const m = /\.([a-z0-9]+)$/i.exec(name);
    return m ? m[1].toLowerCase() : 'mp4';
  }

  function outputMime(fmt: OutputFormat) {
    if (fmt === 'mp4') return 'video/mp4';
    if (fmt === 'webm') return 'video/webm';
    return 'image/gif';
  }

  function buildArgs(inputName: string, outputName: string, fmt: OutputFormat): string[] {
    const trim = ['-ss', String(inPoint), '-to', String(outPoint)];
    if (fmt === 'mp4') {
      return ['-i', inputName, ...trim, '-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast', '-c:a', 'aac', '-movflags', '+faststart', outputName];
    }
    if (fmt === 'webm') {
      return ['-i', inputName, ...trim, '-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-c:a', 'libopus', outputName];
    }
    // gif: no crf (not a codec quality knob for gif); fixed fps/scale for a
    // reasonable file size, per the tip that gif is best for short clips.
    return ['-i', inputName, ...trim, '-vf', 'fps=10,scale=480:-1:flags=lanczos', '-loop', '0', outputName];
  }

  async function startExport() {
    if (!file || status === 'loading-engine' || status === 'exporting') return;
    errorMessage = '';
    progress = 0;

    try {
      if (!ffmpegRef) {
        status = 'loading-engine';
        progressDetail = 'Downloading engine (~30MB, once per session)…';
        ffmpegRef = await loadEngine();
      }

      status = 'exporting';
      progressDetail = 'Starting…';

      progressHandler = (e) => {
        const p = Math.min(1, Math.max(0, e.progress || 0));
        progress = p;
        progressDetail = `${Math.round(p * 100)}%`;
      };
      ffmpegRef.on('progress', progressHandler);

      const inputExt = extOf(file.name);
      const inputName = `input.${inputExt}`;
      const outputName = `output.${outputFormat}`;

      const { fetchFile } = await import('@ffmpeg/util');
      const data = await fetchFile(file);
      await ffmpegRef.writeFile(inputName, data);

      const args = buildArgs(inputName, outputName, outputFormat);
      await ffmpegRef.exec(args);

      const result = await ffmpegRef.readFile(outputName);
      const bytes = result as Uint8Array;
      const blob = new Blob([bytes], { type: outputMime(outputFormat) });

      if (outputUrl) URL.revokeObjectURL(outputUrl);
      outputUrl = URL.createObjectURL(blob);
      outputSize = blob.size;

      try {
        await ffmpegRef.deleteFile(inputName);
        await ffmpegRef.deleteFile(outputName);
      } catch {
        // best-effort cleanup; not fatal
      }

      status = 'done';
    } catch (err) {
      status = 'error';
      errorMessage = err instanceof Error ? err.message : 'Export failed. Check your connection and try again.';
    } finally {
      if (ffmpegRef && progressHandler) {
        ffmpegRef.off('progress', progressHandler);
        progressHandler = null;
      }
    }
  }

  function reset(clearFile = true) {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    videoUrl = '';
    outputUrl = '';
    outputSize = 0;
    progress = 0;
    duration = 0;
    inPoint = 0;
    outPoint = 0;
    if (clearFile) {
      file = null;
      status = 'idle';
    }
  }

  onDestroy(() => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    if (ffmpegRef && progressHandler) {
      ffmpegRef.off('progress', progressHandler);
    }
  });
</script>

<div class="console">
  {#if status === 'idle'}
    <Dropzone accept="video/*" onfiles={onFiles} label="Drop a video, or click to choose" hint="MP4, WebM, MOV, AVI, MKV" />
  {:else}
    <video
      bind:this={hiddenVideoEl}
      src={videoUrl}
      onloadedmetadata={onLoadedMetadata}
      class="preview"
      controls
      playsinline
      muted
    ></video>

    <div class="file-row">
      <span class="readout">{file?.name}</span>
      <span class="readout fg-faint">{file ? formatBytes(file.size) : ''}</span>
      <button type="button" class="reset-btn" onclick={() => reset(true)} disabled={status === 'exporting' || status === 'loading-engine'}>
        Choose a different file
      </button>
    </div>

    {#if duration > 0}
      <div class="timeline">
        <div class="timeline-track">
          <div
            class="timeline-range"
            style={`left:${(inPoint / duration) * 100}%; width:${((outPoint - inPoint) / duration) * 100}%`}
          ></div>
        </div>
      </div>

      <div class="trim-row">
        <SteppedSlider
          label="In point"
          bind:value={inPoint}
          min={0}
          max={duration}
          step={0.1}
          format={formatTime}
          onchange={onInPointChange}
        />
        <SteppedSlider
          label="Out point"
          bind:value={outPoint}
          min={0}
          max={duration}
          step={0.1}
          format={formatTime}
          onchange={onOutPointChange}
        />
      </div>
    {/if}

    <div class="settings-row">
      <Dial
        label="Compression"
        bind:value={crf}
        min={18}
        max={35}
        step={1}
        format={(v) => `CRF ${v}`}
        onchange={(v) => (crf = v)}
      />
      <div class="format-field">
        <span class="field-label">Output format</span>
        <div class="format-toggle">
          <button type="button" class:active={outputFormat === 'mp4'} onclick={() => (outputFormat = 'mp4')}>MP4</button>
          <button type="button" class:active={outputFormat === 'webm'} onclick={() => (outputFormat = 'webm')}>WebM</button>
          <button type="button" class:active={outputFormat === 'gif'} onclick={() => (outputFormat = 'gif')}>GIF</button>
        </div>
        <p class="format-hint readout">
          {outputFormat === 'gif' ? 'Compression dial doesn’t apply to GIF — fixed 10fps, 480px wide.' : 'Lower = higher quality, larger file. Higher = smaller file, lower quality.'}
        </p>
      </div>
    </div>

    {#if status === 'loading-engine' || status === 'exporting'}
      <ProgressReadout
        label={status === 'loading-engine' ? 'Loading engine' : 'Exporting'}
        detail={progressDetail}
        value={progress}
        indeterminate={status === 'loading-engine'}
      />
    {/if}

    {#if status === 'error'}
      <p class="error-msg">{errorMessage}</p>
    {/if}

    {#if status === 'done'}
      <div class="result-row">
        <div class="size-compare">
          <span class="readout">Before: {file ? formatBytes(file.size) : '—'}</span>
          <span class="readout">After: {formatBytes(outputSize)}</span>
        </div>
        <a class="download-btn" href={outputUrl} download={`compressed.${outputFormat}`}>Download {outputFormat.toUpperCase()}</a>
      </div>
    {/if}

    <div class="action-row">
      <button
        type="button"
        class="export-btn"
        onclick={startExport}
        disabled={!file || duration === 0 || status === 'loading-engine' || status === 'exporting'}
      >
        {#if status === 'loading-engine'}
          Loading engine…
        {:else if status === 'exporting'}
          Exporting…
        {:else}
          Export
        {/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .console {
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .preview {
    width: 100%;
    max-height: 40vh;
    background: #0c0c0b;
    border: 1px solid var(--border-strong);
    display: block;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    font-size: var(--text-sm);
  }

  .fg-faint {
    color: var(--fg-faint);
  }

  .reset-btn {
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg-soft);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
  }

  .timeline-track {
    position: relative;
    height: 8px;
    background: var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .timeline-range {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--signal);
  }

  .trim-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  .settings-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-6);
    flex-wrap: wrap;
  }

  .format-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-width: 24em;
  }

  .field-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-faint);
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

  .format-hint {
    font-size: var(--text-xs);
    color: var(--fg-faint);
    margin: 0;
  }

  .error-msg {
    color: var(--signal-text);
    font-size: var(--text-sm);
  }

  .result-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
    border: 1px solid var(--border);
    padding: var(--space-4);
    border-radius: var(--radius-md);
  }

  .size-compare {
    display: flex;
    gap: var(--space-4);
    font-size: var(--text-sm);
  }

  .download-btn {
    background: var(--signal);
    color: var(--color-ink);
    border: none;
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
    text-decoration: none;
  }

  .action-row {
    display: flex;
    justify-content: flex-end;
  }

  .export-btn {
    background: var(--signal);
    color: var(--color-ink);
    border: none;
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .export-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 700px) {
    .trim-row {
      grid-template-columns: 1fr;
    }
  }
</style>

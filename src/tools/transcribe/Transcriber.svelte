<script lang="ts">
  import { onDestroy } from 'svelte';
  import Dropzone from '../../design/primitives/Dropzone.svelte';
  import ProgressReadout from '../../design/primitives/ProgressReadout.svelte';
  import SteppedSlider from '../../design/primitives/SteppedSlider.svelte';
  import Led from '../../design/primitives/Led.svelte';

  interface Chunk {
    timestamp: [number, number | null];
    text: string;
  }

  type Status = 'idle' | 'decoding' | 'loading-model' | 'transcribing' | 'done' | 'error';
  type Device = 'webgpu' | 'wasm';

  interface ProgressInfo {
    status: string;
    file?: string;
    progress?: number;
    loaded?: number;
    total?: number;
  }

  // A small, a mid-size multilingual Whisper ONNX build — both from onnx-community on the Hub.
  const MODELS: { id: string; label: string }[] = [
    { id: 'onnx-community/whisper-tiny', label: 'Fast' },
    { id: 'onnx-community/whisper-base', label: 'Accurate' },
  ];

  const webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;

  let status = $state<Status>('idle');
  let errorMessage = $state('');

  let fileName = $state('');
  let fileUrl = $state('');
  let duration = $state(0);
  let pcm = $state<Float32Array | null>(null);

  let modelIndex = $state(0);
  let device = $state<Device>(webgpuAvailable ? 'webgpu' : 'wasm');

  let modelProgress = $state(0);
  let modelProgressDetail = $state('');
  let transcribeDetail = $state('');

  let chunks = $state<Chunk[]>([]);
  let fullText = $state('');
  let currentTime = $state(0);

  let audioEl: HTMLAudioElement | undefined;
  let canvasEl: HTMLCanvasElement | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pipelineInstance: any = null;
  let loadedModelId = '';
  let loadedDevice: Device | '' = '';

  const supported = typeof window !== 'undefined' && 'AudioContext' in window;

  let activeChunkIndex = $derived(findActiveChunk(chunks, currentTime));

  function findActiveChunk(list: Chunk[], t: number): number {
    for (let i = 0; i < list.length; i++) {
      const [start, end] = list[i].timestamp;
      if (t >= start && (end === null || t <= end + 0.05)) return i;
    }
    return -1;
  }

  function formatDuration(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function reset() {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = '';
    fileName = '';
    pcm = null;
    duration = 0;
    chunks = [];
    fullText = '';
    currentTime = 0;
    status = 'idle';
    errorMessage = '';
    modelProgress = 0;
    modelProgressDetail = '';
    transcribeDetail = '';
  }

  async function handleFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    reset();
    if (!supported) {
      status = 'error';
      errorMessage = "This browser doesn't support the Web Audio API needed to decode audio locally.";
      return;
    }
    fileName = file.name;
    fileUrl = URL.createObjectURL(file);
    status = 'decoding';
    try {
      const arrayBuffer = await file.arrayBuffer();
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const decodeCtx = new AudioCtx();
      const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
      await decodeCtx.close();

      duration = audioBuffer.duration;

      const targetRate = 16000;
      const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(audioBuffer.duration * targetRate)), targetRate);
      const source = offline.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();
      pcm = rendered.getChannelData(0).slice();

      status = 'idle';
    } catch (err) {
      status = 'error';
      errorMessage =
        'Could not decode this file as audio. It may be an unsupported codec/container, or protected content.';
      console.error(err);
    }
  }

  $effect(() => {
    if (pcm && canvasEl) drawWaveform(pcm, canvasEl);
  });

  function drawWaveform(data: Float32Array, canvas: HTMLCanvasElement) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 96;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    const samplesPerPixel = Math.max(1, Math.floor(data.length / w));
    const styles = getComputedStyle(document.documentElement);
    ctx.strokeStyle = styles.getPropertyValue('--fg-soft').trim() || '#4a4842';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const start = x * samplesPerPixel;
      let min = 1;
      let max = -1;
      for (let i = 0; i < samplesPerPixel; i++) {
        const v = data[start + i];
        if (v === undefined) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max < min) {
        min = 0;
        max = 0;
      }
      ctx.moveTo(x + 0.5, mid + min * mid);
      ctx.lineTo(x + 0.5, mid + max * mid);
    }
    ctx.stroke();
  }

  function onProgress(info: ProgressInfo) {
    if (info.status === 'progress' || info.status === 'progress_total') {
      const pct = (info.progress ?? 0) / 100;
      modelProgress = Math.max(0, Math.min(1, pct));
      if (info.loaded && info.total) {
        modelProgressDetail = `${(info.loaded / 1e6).toFixed(1)} / ${(info.total / 1e6).toFixed(1)} MB`;
      } else {
        modelProgressDetail = `${Math.round(modelProgress * 100)}%`;
      }
    } else if (info.status === 'initiate' || info.status === 'download') {
      modelProgressDetail = info.file ? `Fetching ${info.file}` : 'Preparing model…';
    } else if (info.status === 'done') {
      modelProgressDetail = info.file ? `${info.file} ready` : modelProgressDetail;
    } else if (info.status === 'ready') {
      modelProgress = 1;
      modelProgressDetail = 'Model ready';
    }
  }

  async function loadPipeline(modelId: string) {
    if (pipelineInstance && loadedModelId === modelId && loadedDevice === device) {
      return pipelineInstance;
    }
    if (pipelineInstance?.dispose) {
      try {
        await pipelineInstance.dispose();
      } catch {
        // ignore
      }
    }
    pipelineInstance = null;

    const { pipeline } = await import('@huggingface/transformers');
    const attempts: Device[] = webgpuAvailable ? ['webgpu', 'wasm'] : ['wasm'];
    let lastError: unknown;
    for (const attempt of attempts) {
      modelProgress = 0;
      modelProgressDetail = '';
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const instance = await pipeline('automatic-speech-recognition', modelId, {
          device: attempt,
          progress_callback: onProgress,
        } as any);
        device = attempt;
        pipelineInstance = instance;
        loadedModelId = modelId;
        loadedDevice = attempt;
        return instance;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  async function transcribe() {
    if (!pcm) return;
    status = 'loading-model';
    errorMessage = '';
    transcribeDetail = '';
    const modelId = MODELS[modelIndex].id;
    try {
      const asr = await loadPipeline(modelId);

      status = 'transcribing';
      transcribeDetail = 'Running inference — this can take a while on longer files.';
      const output = await asr(pcm, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });

      const rawChunks = Array.isArray(output?.chunks) ? output.chunks : [];
      chunks = rawChunks.map((c: { timestamp: [number, number | null]; text: string }) => ({
        timestamp: c.timestamp,
        text: c.text,
      }));
      fullText = typeof output?.text === 'string' ? output.text : chunks.map((c) => c.text).join('');
      status = 'done';
    } catch (err) {
      status = 'error';
      const msg = err instanceof Error ? err.message : String(err);
      errorMessage = /fetch|network|Failed to fetch|NetworkError|ENOTFOUND/i.test(msg)
        ? 'Could not download the speech model. Check your connection and try again.'
        : `Transcription failed: ${msg}`;
      console.error(err);
    }
  }

  function seekTo(t: number) {
    if (!audioEl) return;
    audioEl.currentTime = t;
    void audioEl.play();
  }

  function pad(n: number): string {
    return String(Math.floor(n)).padStart(2, '0');
  }

  function formatSrtTime(seconds: number): string {
    const s = Math.max(0, seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.round((s - Math.floor(s)) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(sec)},${String(ms).padStart(3, '0')}`;
  }

  function formatVttTime(seconds: number): string {
    return formatSrtTime(seconds).replace(',', '.');
  }

  function resolvedEnd(chunk: Chunk, index: number, list: Chunk[]): number {
    if (chunk.timestamp[1] != null) return chunk.timestamp[1];
    const next = list[index + 1];
    return next ? next.timestamp[0] : chunk.timestamp[0] + 2;
  }

  function buildSrt(list: Chunk[]): string {
    return list
      .map((c, i) => {
        const start = formatSrtTime(c.timestamp[0]);
        const end = formatSrtTime(resolvedEnd(c, i, list));
        return `${i + 1}\n${start} --> ${end}\n${c.text.trim()}\n`;
      })
      .join('\n');
  }

  function buildVtt(list: Chunk[]): string {
    const body = list
      .map((c, i) => {
        const start = formatVttTime(c.timestamp[0]);
        const end = formatVttTime(resolvedEnd(c, i, list));
        return `${start} --> ${end}\n${c.text.trim()}\n`;
      })
      .join('\n');
    return `WEBVTT\n\n${body}`;
  }

  function triggerDownload(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function baseName(): string {
    return fileName.replace(/\.[^.]+$/, '') || 'transcript';
  }

  function exportTxt() {
    triggerDownload(`${baseName()}.txt`, `${fullText.trim()}\n`, 'text/plain');
  }
  function exportSrt() {
    triggerDownload(`${baseName()}.srt`, buildSrt(chunks), 'application/x-subrip');
  }
  function exportVtt() {
    triggerDownload(`${baseName()}.vtt`, buildVtt(chunks), 'text/vtt');
  }

  onDestroy(() => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    if (pipelineInstance?.dispose) {
      pipelineInstance.dispose().catch(() => {});
    }
  });
</script>

<div class="console">
  {#if !supported}
    <p class="error-msg">This browser doesn't support the Web Audio API needed to decode audio locally.</p>
  {:else if !pcm}
    <Dropzone
      accept="audio/*,video/*"
      label="Drop an audio or video file, or click to choose"
      hint="MP3, WAV, M4A, MP4, WebM, and most browser-playable formats"
      onfiles={handleFiles}
      disabled={status === 'decoding'}
    />
    {#if status === 'decoding'}
      <p class="hint readout">Decoding audio…</p>
    {/if}
    {#if status === 'error'}
      <p class="error-msg">{errorMessage}</p>
    {/if}
  {:else}
    <div class="file-head">
      <div>
        <p class="file-name">{fileName}</p>
        <p class="readout file-meta">{formatDuration(duration)} · resampled to 16kHz mono</p>
      </div>
      <button type="button" class="ghost-btn" onclick={reset}>Choose a different file</button>
    </div>

    <div class="waveform-wrap">
      <canvas bind:this={canvasEl} class="waveform" role="img" aria-label="Audio waveform"></canvas>
      {#if duration > 0}
        <div class="playhead" style={`left:${Math.min(100, (currentTime / duration) * 100)}%`}></div>
      {/if}
    </div>

    <!-- svelte-ignore a11y_media_has_caption -->
    <audio
      bind:this={audioEl}
      src={fileUrl}
      controls
      ontimeupdate={() => (currentTime = audioEl?.currentTime ?? 0)}
      class="player"
    ></audio>

    {#if status !== 'transcribing' && status !== 'loading-model'}
      <div class="controls-row">
        <div class="model-picker">
          <SteppedSlider
            label="Model"
            bind:value={modelIndex}
            min={0}
            max={MODELS.length - 1}
            step={1}
            ticks={MODELS.map((m) => m.label)}
            format={(v) => MODELS[v]?.label ?? ''}
          />
          <p class="readout compute-note">
            Compute: {webgpuAvailable ? 'WebGPU' : 'WASM (WebGPU unavailable in this browser)'}
          </p>
        </div>
        <button type="button" class="primary-btn" onclick={transcribe}>
          {status === 'done' ? 'Re-transcribe' : 'Transcribe'}
        </button>
      </div>
    {/if}

    {#if status === 'loading-model'}
      <div class="progress-block">
        <Led state="live" label="Loading model" />
        <ProgressReadout label={`Downloading Whisper (${device})`} value={modelProgress} detail={modelProgressDetail} />
      </div>
    {:else if status === 'transcribing'}
      <div class="progress-block">
        <Led state="live" label="Transcribing" />
        <ProgressReadout label="Running speech recognition" indeterminate detail={transcribeDetail} />
      </div>
    {/if}

    {#if status === 'error'}
      <p class="error-msg">
        {errorMessage}
        <button type="button" class="ghost-btn" onclick={transcribe}>Retry</button>
      </p>
    {/if}

    {#if chunks.length || fullText}
      <div class="transcript">
        <div class="transcript-head">
          <Led state="ready" label={`${device} · ${MODELS[modelIndex].label}`} />
          <div class="export-buttons">
            <button type="button" class="ghost-btn" onclick={exportTxt}>.txt</button>
            <button type="button" class="ghost-btn" onclick={exportSrt} disabled={!chunks.length}>.srt</button>
            <button type="button" class="ghost-btn" onclick={exportVtt} disabled={!chunks.length}>.vtt</button>
          </div>
        </div>
        <div class="transcript-body">
          {#if chunks.length}
            {#each chunks as chunk, i (i)}
              <span
                class="chunk"
                class:active={i === activeChunkIndex}
                role="button"
                tabindex="0"
                onclick={() => seekTo(chunk.timestamp[0])}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    seekTo(chunk.timestamp[0]);
                  }
                }}
              >{chunk.text}</span>
            {/each}
          {:else}
            <p class="transcript-text">{fullText}</p>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .console {
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-5);
  }

  .hint {
    margin: var(--space-3) 0 0;
    color: var(--fg-faint);
    font-size: var(--text-xs);
  }

  .error-msg {
    margin: var(--space-3) 0 0;
    color: var(--signal);
    font-size: var(--text-sm);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .file-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
    flex-wrap: wrap;
  }

  .file-name {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 500;
    word-break: break-word;
  }

  .file-meta {
    margin: var(--space-1) 0 0;
    color: var(--fg-faint);
    font-size: var(--text-xs);
  }

  .waveform-wrap {
    position: relative;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    height: 96px;
    margin-bottom: var(--space-3);
  }

  .waveform {
    width: 100%;
    height: 100%;
    display: block;
  }

  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--signal);
    pointer-events: none;
  }

  .player {
    width: 100%;
    margin-bottom: var(--space-5);
  }

  .controls-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
    flex-wrap: wrap;
    margin-bottom: var(--space-4);
  }

  .model-picker {
    flex: 1 1 240px;
    min-width: 200px;
  }

  .compute-note {
    margin: var(--space-2) 0 0;
    color: var(--fg-faint);
    font-size: var(--text-xs);
  }

  .progress-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: var(--bg);
  }

  .transcript {
    margin-top: var(--space-5);
    border-top: 1px solid var(--border);
    padding-top: var(--space-4);
  }

  .transcript-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
    flex-wrap: wrap;
  }

  .export-buttons {
    display: flex;
    gap: var(--space-2);
  }

  .transcript-body {
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    padding: var(--space-4);
    line-height: 1.7;
  }

  .transcript-text {
    margin: 0;
    color: var(--fg);
  }

  .chunk {
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background var(--duration-tick) var(--ease-snap), color var(--duration-tick) var(--ease-snap);
  }

  .chunk:hover {
    background: color-mix(in srgb, var(--signal) 10%, transparent);
  }

  .chunk.active {
    background: color-mix(in srgb, var(--signal) 20%, transparent);
    color: var(--fg);
  }

  .primary-btn {
    background: var(--signal);
    color: var(--signal-fg);
    border: none;
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
    white-space: nowrap;
    transition: opacity var(--duration-tick) var(--ease-snap);
  }

  .primary-btn:hover {
    opacity: 0.9;
  }

  .primary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ghost-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--fg);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-xs);
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: border-color var(--duration-tick) var(--ease-snap), color var(--duration-tick) var(--ease-snap);
  }

  .ghost-btn:hover {
    border-color: var(--signal);
    color: var(--signal);
  }

  .ghost-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>

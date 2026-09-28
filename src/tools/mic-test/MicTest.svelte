<script lang="ts">
  import { onDestroy } from 'svelte';
  import Led from '../../design/primitives/Led.svelte';
  import Meter from '../../design/primitives/Meter.svelte';

  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let rafId: number | null = null;

  let devices = $state<MediaDeviceInfo[]>([]);
  let selectedDeviceId = $state('');
  let status = $state<'idle' | 'requesting' | 'live' | 'error' | 'unsupported'>('idle');
  let errorMessage = $state('');
  let level = $state(0);
  let peakLevel = $state(0);

  let recorder: MediaRecorder | null = null;
  let recordedChunks: Blob[] = [];
  let playbackUrl = $state('');
  let recordingState = $state<'idle' | 'recording' | 'ready'>('idle');

  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  async function listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all.filter((d) => d.kind === 'audioinput');
    } catch {
      devices = [];
    }
  }

  function tick() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (const sample of data) {
      const norm = (sample - 128) / 128;
      sumSquares += norm * norm;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    level = Math.min(1, rms * 3.2);
    peakLevel = Math.max(peakLevel * 0.94, level);
    rafId = requestAnimationFrame(tick);
  }

  async function start(deviceId?: string) {
    if (!supported) {
      status = 'unsupported';
      return;
    }
    status = 'requesting';
    errorMessage = '';
    try {
      stop(false);
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      });
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      const track = stream.getAudioTracks()[0];
      selectedDeviceId = track.getSettings().deviceId ?? selectedDeviceId;

      status = 'live';
      await listDevices();
      tick();
    } catch (err) {
      status = 'error';
      errorMessage = err instanceof Error ? err.message : 'Could not access the microphone.';
    }
  }

  function stop(resetStatus = true) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    audioCtx?.close().catch(() => {});
    audioCtx = null;
    analyser = null;
    level = 0;
    peakLevel = 0;
    if (resetStatus) status = 'idle';
  }

  function onDeviceChange(e: Event) {
    start((e.target as HTMLSelectElement).value);
  }

  function toggleRecording() {
    if (!stream) return;
    if (recordingState === 'recording') {
      recorder?.stop();
      return;
    }
    recordedChunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
      playbackUrl = URL.createObjectURL(blob);
      recordingState = 'ready';
    };
    recorder.start();
    recordingState = 'recording';
  }

  onDestroy(() => {
    stop();
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  });
</script>

<div class="console">
  <div class="meter-panel">
    <div class="meter-head">
      <Led state={status === 'live' ? 'live' : status === 'error' ? 'error' : 'off'} label={status === 'live' ? 'Live' : status} />
    </div>

    {#if status === 'unsupported'}
      <p class="msg">Your browser doesn't support microphone access via getUserMedia.</p>
    {:else if status === 'error'}
      <p class="msg">{errorMessage}</p>
      <button type="button" class="start-btn" onclick={() => start(selectedDeviceId)}>Try again</button>
    {:else if status === 'live'}
      <Meter value={level} label="Input level" peak={peakLevel > 0.9} segments={28} />
      <p class="peak readout">Peak: {Math.round(peakLevel * 100)}%</p>
    {:else}
      <button type="button" class="start-btn" onclick={() => start(selectedDeviceId)} disabled={status === 'requesting'}>
        {status === 'requesting' ? 'Requesting microphone…' : 'Start microphone test'}
      </button>
    {/if}
  </div>

  <div class="controls">
    {#if devices.length > 1}
      <label class="device-picker">
        <span>Microphone</span>
        <select value={selectedDeviceId} onchange={onDeviceChange}>
          {#each devices as d, i}
            <option value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if status === 'live'}
      <div class="record-row">
        <button type="button" class="record-btn" class:active={recordingState === 'recording'} onclick={toggleRecording}>
          {recordingState === 'recording' ? 'Stop 3s test clip' : 'Record a test clip'}
        </button>
        {#if playbackUrl}
          <audio controls src={playbackUrl}></audio>
        {/if}
      </div>
      <button type="button" class="stop-btn" onclick={() => stop()}>Stop microphone</button>
    {/if}
  </div>
</div>

<style>
  .console {
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-6);
  }

  .meter-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-height: 120px;
    justify-content: center;
  }

  .msg {
    color: var(--fg-soft);
  }

  .peak {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }

  .start-btn {
    align-self: flex-start;
    background: var(--signal);
    color: #fff;
    border: none;
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-5);
    flex-wrap: wrap;
  }

  .device-picker {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .device-picker span {
    color: var(--fg-faint);
    text-transform: uppercase;
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
  }

  select {
    background: var(--bg);
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
  }

  .record-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .record-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--fg);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .record-btn.active {
    border-color: var(--signal);
    color: var(--signal);
  }

  .stop-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--fg);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .stop-btn:hover {
    border-color: var(--signal);
    color: var(--signal);
  }

  audio {
    height: 32px;
  }
</style>

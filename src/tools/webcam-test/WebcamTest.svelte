<script lang="ts">
  import { onDestroy } from 'svelte';
  import Led from '../../design/primitives/Led.svelte';

  let videoEl: HTMLVideoElement;
  let stream: MediaStream | null = null;
  let devices = $state<MediaDeviceInfo[]>([]);
  let selectedDeviceId = $state('');
  let status = $state<'idle' | 'requesting' | 'live' | 'error' | 'unsupported'>('idle');
  let errorMessage = $state('');
  let width = $state(0);
  let height = $state(0);
  let fps = $state(0);

  let frameCount = 0;
  let fpsInterval: ReturnType<typeof setInterval> | null = null;

  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  async function listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all.filter((d) => d.kind === 'videoinput');
    } catch {
      devices = [];
    }
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
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      });
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      width = settings.width ?? 0;
      height = settings.height ?? 0;
      selectedDeviceId = settings.deviceId ?? selectedDeviceId;
      status = 'live';
      await listDevices();
      startFpsCounter();
    } catch (err) {
      status = 'error';
      errorMessage = err instanceof Error ? err.message : 'Could not access the camera.';
    }
  }

  function startFpsCounter() {
    frameCount = 0;
    if (fpsInterval) clearInterval(fpsInterval);
    fpsInterval = setInterval(() => {
      fps = frameCount;
      frameCount = 0;
    }, 1000);
    const countFrame = () => {
      if (status !== 'live') return;
      frameCount++;
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        (videoEl as any).requestVideoFrameCallback(countFrame);
      } else {
        requestAnimationFrame(countFrame);
      }
    };
    countFrame();
  }

  function stop(resetStatus = true) {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (fpsInterval) {
      clearInterval(fpsInterval);
      fpsInterval = null;
    }
    if (resetStatus) status = 'idle';
  }

  function onDeviceChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    start(id);
  }

  onDestroy(() => stop());
</script>

<div class="console">
  <div class="viewfinder">
    <video bind:this={videoEl} playsinline muted aria-label="Camera preview"></video>
    {#if status !== 'live'}
      <div class="viewfinder-overlay">
        {#if status === 'unsupported'}
          <p>Your browser doesn't support camera access via getUserMedia.</p>
        {:else if status === 'error'}
          <p>{errorMessage}</p>
          <button type="button" onclick={() => start(selectedDeviceId)}>Try again</button>
        {:else}
          <button type="button" class="start-btn" onclick={() => start(selectedDeviceId)} disabled={status === 'requesting'}>
            {status === 'requesting' ? 'Requesting camera…' : 'Start camera'}
          </button>
        {/if}
      </div>
    {/if}
    <div class="viewfinder-hud">
      <Led state={status === 'live' ? 'live' : status === 'error' ? 'error' : 'off'} label={status === 'live' ? 'Live' : status} />
      {#if status === 'live'}
        <span class="readout hud-spec">{width}&times;{height} · {fps} FPS</span>
      {/if}
    </div>
  </div>

  <div class="controls">
    {#if devices.length > 1}
      <label class="device-picker">
        <span>Camera</span>
        <select value={selectedDeviceId} onchange={onDeviceChange}>
          {#each devices as d, i}
            <option value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if status === 'live'}
      <button type="button" class="stop-btn" onclick={() => stop()}>Stop camera</button>
    {/if}
  </div>
</div>

<style>
  .console {
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-5);
  }

  .viewfinder {
    position: relative;
    aspect-ratio: 16 / 9;
    background: #0c0c0b;
    border: 1px solid var(--border-strong);
    overflow: hidden;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }

  .viewfinder-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    background: rgba(12, 12, 11, 0.85);
    color: var(--color-paper);
    text-align: center;
    padding: var(--space-5);
  }

  .start-btn,
  .viewfinder-overlay button {
    background: var(--signal);
    color: #fff;
    border: none;
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .viewfinder-hud {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    right: var(--space-3);
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--color-paper);
  }

  .hud-spec {
    font-size: var(--text-xs);
    background: rgba(12, 12, 11, 0.6);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
  }

  .controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-4);
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
</style>

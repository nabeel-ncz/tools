<script lang="ts">
  import { onDestroy } from 'svelte';
  import Led from '../../design/primitives/Led.svelte';

  type Status = 'idle' | 'requesting' | 'live' | 'stopped' | 'error' | 'unsupported';

  let status = $state<Status>(
    typeof navigator !== 'undefined' && navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices
      ? 'idle'
      : 'unsupported'
  );
  let errorMessage = $state('');
  let micEnabled = $state(false);
  let webcamEnabled = $state(false);
  let elapsedMs = $state(0);
  let downloadUrl = $state('');
  let downloadSize = $state(0);
  let mimeUsed = $state('video/webm');

  const supported = status !== 'unsupported';

  // Source elements/streams
  let screenVideoEl: HTMLVideoElement;
  let webcamVideoEl: HTMLVideoElement;
  let canvasEl: HTMLCanvasElement;

  let screenStream: MediaStream | null = null;
  let micStream: MediaStream | null = null;
  let webcamStream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let recordStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];

  let rafId: number | null = null;
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let startedAt = 0;

  function formatElapsed(ms: number) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60)
      .toString()
      .padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function drawFrame() {
    if (status !== 'live' || !canvasEl || !screenVideoEl) return;
    const ctx = canvasEl.getContext('2d');
    if (ctx) {
      ctx.drawImage(screenVideoEl, 0, 0, canvasEl.width, canvasEl.height);
      if (webcamEnabled && webcamVideoEl && webcamVideoEl.videoWidth > 0) {
        const bubbleRadius = Math.round(Math.min(canvasEl.width, canvasEl.height) * 0.12);
        const cx = canvasEl.width - bubbleRadius - 24;
        const cy = canvasEl.height - bubbleRadius - 24;
        const vw = webcamVideoEl.videoWidth;
        const vh = webcamVideoEl.videoHeight;
        const scale = (bubbleRadius * 2) / Math.min(vw, vh);
        const dw = vw * scale;
        const dh = vh * scale;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, bubbleRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(webcamVideoEl, cx - dw / 2, cy - dh / 2, dw, dh);
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, bubbleRadius, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.stroke();
        ctx.restore();
      }
    }
    rafId = requestAnimationFrame(drawFrame);
  }

  async function start() {
    if (!supported) {
      status = 'unsupported';
      return;
    }
    status = 'requesting';
    errorMessage = '';
    chunks = [];
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const screen = screenStream;

      if (micEnabled) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
          micStream = null;
          micEnabled = false;
        }
      }

      if (webcamEnabled) {
        try {
          webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (err) {
          webcamStream = null;
          webcamEnabled = false;
        }
      }

      if (screenVideoEl) {
        screenVideoEl.srcObject = screen;
        await screenVideoEl.play();
      }
      const webcamStreamAtStart = webcamStream;
      if (webcamEnabled && webcamStreamAtStart && webcamVideoEl) {
        webcamVideoEl.srcObject = webcamStreamAtStart;
        await webcamVideoEl.play();
      }

      // Build the final video track: composited canvas if webcam bubble is on,
      // otherwise the raw screen track (no extra compositing overhead).
      let videoTrack: MediaStreamTrack;
      if (webcamEnabled && webcamStreamAtStart) {
        const settings = screen.getVideoTracks()[0]?.getSettings();
        canvasEl.width = settings?.width || screenVideoEl.videoWidth || 1280;
        canvasEl.height = settings?.height || screenVideoEl.videoHeight || 720;
        rafId = requestAnimationFrame(drawFrame);
        const canvasStream = canvasEl.captureStream(30);
        videoTrack = canvasStream.getVideoTracks()[0];
      } else {
        videoTrack = screen.getVideoTracks()[0];
      }

      // Mix audio (screen audio + mic) through a shared AudioContext into one track.
      const micStreamAtStart = micStream;
      const screenAudioTracks = screen.getAudioTracks();
      let audioTrack: MediaStreamTrack | null = null;
      if (screenAudioTracks.length > 0 || micStreamAtStart) {
        audioCtx = new AudioContext();
        const dest = audioCtx.createMediaStreamDestination();
        if (screenAudioTracks.length > 0) {
          const src = audioCtx.createMediaStreamSource(new MediaStream([screenAudioTracks[0]]));
          src.connect(dest);
        }
        if (micStreamAtStart) {
          const src = audioCtx.createMediaStreamSource(micStreamAtStart);
          src.connect(dest);
        }
        audioTrack = dest.stream.getAudioTracks()[0];
      }

      const tracks = [videoTrack, ...(audioTrack ? [audioTrack] : [])];
      recordStream = new MediaStream(tracks);

      const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      mimeUsed = candidates.find((c) => MediaRecorder.isTypeSupported(c)) || 'video/webm';

      recorder = new MediaRecorder(recordStream, { mimeType: mimeUsed });
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = finalizeRecording;
      recorder.start(1000);

      // If the user stops sharing via the browser's own "Stop sharing" UI,
      // end the recording gracefully instead of leaving it hanging.
      screen.getVideoTracks()[0].addEventListener('ended', () => {
        if (status === 'live') stop();
      });

      startedAt = Date.now();
      elapsedMs = 0;
      timerInterval = setInterval(() => {
        elapsedMs = Date.now() - startedAt;
      }, 250);

      status = 'live';
    } catch (err) {
      cleanupStreams();
      status = 'error';
      errorMessage = err instanceof Error ? err.message : 'Could not start screen recording.';
    }
  }

  function stop() {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      finalizeRecording();
    }
  }

  function finalizeRecording() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    const blob = new Blob(chunks, { type: mimeUsed.split(';')[0] });
    chunks = [];
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(blob);
    downloadSize = blob.size;
    cleanupStreams();
    status = 'stopped';
  }

  function cleanupStreams() {
    screenStream?.getTracks().forEach((t) => t.stop());
    micStream?.getTracks().forEach((t) => t.stop());
    webcamStream?.getTracks().forEach((t) => t.stop());
    recordStream?.getTracks().forEach((t) => t.stop());
    screenStream = null;
    micStream = null;
    webcamStream = null;
    recordStream = null;
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    if (screenVideoEl) screenVideoEl.srcObject = null;
    if (webcamVideoEl) webcamVideoEl.srcObject = null;
    recorder = null;
  }

  function reset() {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      downloadUrl = '';
    }
    downloadSize = 0;
    elapsedMs = 0;
    status = 'idle';
  }

  function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function extFor(mime: string) {
    return mime.startsWith('video/webm') ? 'webm' : 'mp4';
  }

  onDestroy(() => {
    if (timerInterval) clearInterval(timerInterval);
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // ignore
      }
    }
    cleanupStreams();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  });
</script>

<div class="console">
  {#if status === 'unsupported'}
    <div class="unsupported">
      <p>
        Your browser doesn't support screen capture (<code>getDisplayMedia</code>). Screen recording generally isn't
        available on mobile browsers — try Chrome, Edge, or Firefox on desktop, or use your device's built-in screen
        recorder.
      </p>
    </div>
  {:else}
    <div class="viewfinder">
      <video
        bind:this={screenVideoEl}
        playsinline
        muted
        class="frame-layer"
        class:offscreen={webcamEnabled || status !== 'live'}
      ></video>
      <video bind:this={webcamVideoEl} playsinline muted class="frame-layer offscreen"></video>
      <canvas bind:this={canvasEl} class="frame-layer" class:hidden={!(webcamEnabled && status === 'live')}></canvas>

      {#if status === 'idle'}
        <div class="viewfinder-overlay">
          <p class="idle-copy">Choose your sources, then click Start to pick what to share.</p>
          <div class="toggles">
            <button
              type="button"
              class="toggle"
              class:active={micEnabled}
              aria-pressed={micEnabled}
              onclick={() => (micEnabled = !micEnabled)}
            >
              Microphone: {micEnabled ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              class="toggle"
              class:active={webcamEnabled}
              aria-pressed={webcamEnabled}
              onclick={() => (webcamEnabled = !webcamEnabled)}
            >
              Webcam bubble: {webcamEnabled ? 'On' : 'Off'}
            </button>
          </div>
          <button type="button" class="rec-btn" onclick={start}>
            <span class="rec-dot" aria-hidden="true"></span> Start recording
          </button>
        </div>
      {:else if status === 'requesting'}
        <div class="viewfinder-overlay">
          <p>Waiting for you to choose a screen, window, or tab&hellip;</p>
        </div>
      {:else if status === 'error'}
        <div class="viewfinder-overlay">
          <p>{errorMessage}</p>
          <button type="button" onclick={start}>Try again</button>
        </div>
      {:else if status === 'stopped'}
        <div class="viewfinder-overlay">
          <p>Recording ready &mdash; {formatBytes(downloadSize)}</p>
          <a class="download-btn" href={downloadUrl} download={`screen-recording.${extFor(mimeUsed)}`}>
            Download recording
          </a>
          <button type="button" class="secondary-btn" onclick={reset}>Record another</button>
        </div>
      {/if}

      {#if status === 'live'}
        <div class="viewfinder-hud">
          <Led state="live" label="Recording" />
          <span class="readout hud-time">{formatElapsed(elapsedMs)}</span>
        </div>
      {/if}
    </div>

    {#if status === 'live'}
      <div class="controls">
        <span class="source-note">
          {micEnabled ? 'Mic on' : 'Mic off'} &middot; {webcamEnabled ? 'Webcam bubble on' : 'Webcam bubble off'}
        </span>
        <button type="button" class="stop-btn" onclick={stop}>
          <span class="stop-square" aria-hidden="true"></span> Stop recording
        </button>
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

  .unsupported {
    padding: var(--space-6);
    text-align: center;
    color: var(--fg-soft);
  }

  .viewfinder {
    position: relative;
    aspect-ratio: 16 / 9;
    background: #0c0c0b;
    border: 1px solid var(--border-strong);
    overflow: hidden;
  }

  .frame-layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  /* Kept in the document (not display:none) so the browser keeps decoding
     frames for canvas.drawImage() to read from, just moved out of view. */
  .frame-layer.offscreen {
    position: fixed;
    left: -9999px;
    top: 0;
    width: 2px;
    height: 2px;
    opacity: 0;
    pointer-events: none;
  }

  canvas.hidden {
    display: none;
  }

  .viewfinder-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    background: rgba(12, 12, 11, 0.85);
    color: var(--color-paper);
    text-align: center;
    padding: var(--space-5);
  }

  .idle-copy {
    margin: 0;
    max-width: 32em;
    color: var(--color-paper);
    opacity: 0.85;
  }

  .toggles {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    justify-content: center;
  }

  .toggle {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.35);
    color: var(--color-paper);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
    transition:
      border-color var(--duration-tick) var(--ease-snap),
      color var(--duration-tick) var(--ease-snap);
  }

  .toggle.active {
    border-color: var(--signal-text);
    color: var(--signal-text);
  }

  .rec-btn,
  .viewfinder-overlay button:not(.toggle),
  .download-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    background: var(--signal);
    color: var(--color-ink);
    border: none;
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
    text-decoration: none;
  }

  .rec-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #fff;
  }

  .secondary-btn {
    background: transparent !important;
    border: 1px solid rgba(255, 255, 255, 0.35) !important;
    color: var(--color-paper) !important;
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

  .hud-time {
    font-size: var(--text-sm);
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

  .source-note {
    font-size: var(--text-sm);
    color: var(--fg-faint);
  }

  .stop-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    background: transparent;
    border: 1px solid var(--signal);
    color: var(--signal-text);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .stop-square {
    width: 10px;
    height: 10px;
    background: var(--signal);
  }
</style>

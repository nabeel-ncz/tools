<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import QRCode from 'qrcode';
  import Led from '../../design/primitives/Led.svelte';
  import ProgressReadout from '../../design/primitives/ProgressReadout.svelte';
  import Dropzone from '../../design/primitives/Dropzone.svelte';

  type WsStatus = 'idle' | 'connecting' | 'open' | 'closed';
  type PeerStatus = 'idle' | 'waiting' | 'negotiating' | 'connected' | 'closed' | 'failed';
  type Role = 'host' | 'joiner' | null;

  interface TransferItem {
    id: string;
    name: string;
    size: number;
    mime: string;
    bytesDone: number;
    direction: 'send' | 'receive';
    status: 'active' | 'done' | 'error';
    startedAt: number;
    rateBps: number;
  }

  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1 — easy to read aloud
  const CHUNK_SIZE = 16 * 1024; // 16KB — safe across browsers for RTCDataChannel messages
  const BUFFER_HIGH_WATER = 1024 * 1024; // pause sending above 1MB buffered
  const BUFFER_LOW_WATER = 256 * 1024; // resume once buffered drops below this
  const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  const supported =
    typeof window !== 'undefined' &&
    !!window.RTCPeerConnection &&
    !!window.WebSocket &&
    !!window.crypto?.getRandomValues;

  let role = $state<Role>(null);
  let code = $state('');
  let origin = $state('');
  let joinInput = $state('');
  let wsStatus = $state<WsStatus>('idle');
  let peerStatus = $state<PeerStatus>('idle');
  let errorMessage = $state('');
  let qrCanvas: HTMLCanvasElement | undefined = $state();

  let outgoing = $state<TransferItem[]>([]);
  let incoming = $state<TransferItem[]>([]);

  // Plain (non-reactive) connection internals — status fields above drive the UI.
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  const receiveBuffers = new Map<string, { chunks: ArrayBuffer[]; received: number }>();
  let pendingFiles: File[] = [];
  let sendQueueBusy = false;

  const pairingUrl = $derived(code && origin ? `${origin}?join=${code}` : '');
  const anyTransferActive = $derived(
    outgoing.some((t) => t.status === 'active') || incoming.some((t) => t.status === 'active'),
  );

  const ledState = $derived.by((): 'off' | 'ready' | 'live' | 'error' => {
    if (!supported) return 'error';
    if (peerStatus === 'connected') return 'live';
    if (peerStatus === 'failed') return 'error';
    if (wsStatus === 'connecting' || peerStatus === 'waiting' || peerStatus === 'negotiating') return 'ready';
    return 'off';
  });

  const ledLabel = $derived.by(() => {
    if (!supported) return 'Unsupported';
    switch (peerStatus) {
      case 'connected':
        return anyTransferActive ? 'Transferring' : 'Connected';
      case 'negotiating':
        return 'Negotiating';
      case 'waiting':
        return 'Waiting for peer';
      case 'failed':
        return 'Connection failed';
      case 'closed':
        return 'Peer disconnected';
      default:
        return wsStatus === 'connecting' ? 'Connecting' : 'Idle';
    }
  });

  function generateCode(length = 6): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
  }

  function signalingUrl(sessionCode: string): string {
    const envUrl = import.meta.env.PUBLIC_SIGNALING_URL;
    if (envUrl) return `${envUrl.replace(/\/$/, '')}/${sessionCode}`;
    // Fallback: same-origin `/ws/filedrop/<code>`. This only resolves once
    // workers/filedrop is deployed and this path is routed to it — see
    // workers/filedrop/README.md. Without that, the WebSocket simply fails
    // to connect and the UI reports it below.
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws/filedrop/${sessionCode}`;
  }

  function sendSignal(payload: Record<string, unknown>) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function connectSignaling(sessionCode: string) {
    resetConnectionState();
    wsStatus = 'connecting';
    let socket: WebSocket;
    try {
      socket = new WebSocket(signalingUrl(sessionCode));
    } catch {
      wsStatus = 'closed';
      errorMessage = 'Could not reach the signaling server.';
      return;
    }
    ws = socket;

    socket.addEventListener('open', () => {
      wsStatus = 'open';
      peerStatus = 'waiting';
    });
    socket.addEventListener('message', (event) => handleSignal(event.data));
    socket.addEventListener('close', () => {
      wsStatus = 'closed';
      if (peerStatus !== 'connected') peerStatus = 'failed';
    });
    socket.addEventListener('error', () => {
      if (!errorMessage) errorMessage = 'Signaling connection error.';
    });
  }

  function handleSignal(raw: unknown) {
    if (typeof raw !== 'string') return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'session-created':
      case 'session-joined':
        return;
      case 'peer-joined':
        if (role === 'host') {
          peerStatus = 'negotiating';
          void startAsHost();
        }
        return;
      case 'peer-left':
        handlePeerLeft();
        return;
      case 'error':
        errorMessage = typeof msg.message === 'string' ? msg.message : 'Signaling server rejected a message.';
        return;
    }

    if (msg.kind === 'sdp') {
      void handleRemoteSdp(msg as { sdpType: RTCSdpType; sdp: string });
    } else if (msg.kind === 'ice') {
      void handleRemoteIce((msg.candidate ?? null) as RTCIceCandidateInit | null);
    }
  }

  function ensurePeerConnection(): RTCPeerConnection {
    if (pc) return pc;
    const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    conn.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ kind: 'ice', candidate: event.candidate.toJSON() });
      }
    };
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === 'failed' || conn.connectionState === 'disconnected') {
        peerStatus = 'failed';
        if (!errorMessage) errorMessage = 'Peer connection lost. Try reloading both devices.';
      }
    };
    conn.ondatachannel = (event) => setupDataChannel(event.channel);
    pc = conn;
    return conn;
  }

  async function startAsHost() {
    const conn = ensurePeerConnection();
    const channel = conn.createDataChannel('filedrop', { ordered: true });
    setupDataChannel(channel);
    try {
      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      sendSignal({ kind: 'sdp', sdpType: 'offer', sdp: conn.localDescription?.sdp });
    } catch {
      peerStatus = 'failed';
      errorMessage = 'Could not start the connection offer.';
    }
  }

  async function handleRemoteSdp(msg: { sdpType: RTCSdpType; sdp: string }) {
    const conn = ensurePeerConnection();
    try {
      await conn.setRemoteDescription({ type: msg.sdpType, sdp: msg.sdp });
      if (msg.sdpType === 'offer') {
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);
        sendSignal({ kind: 'sdp', sdpType: 'answer', sdp: conn.localDescription?.sdp });
      }
      const queued = pendingRemoteCandidates.splice(0);
      for (const candidate of queued) {
        await conn.addIceCandidate(candidate).catch(() => {});
      }
    } catch {
      peerStatus = 'failed';
      errorMessage = 'Could not negotiate the peer connection.';
    }
  }

  async function handleRemoteIce(candidate: RTCIceCandidateInit | null) {
    if (!candidate) return;
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(candidate).catch(() => {});
    } else {
      pendingRemoteCandidates.push(candidate);
    }
  }

  function setupDataChannel(channel: RTCDataChannel) {
    dc = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
    channel.onopen = () => {
      peerStatus = 'connected';
      errorMessage = '';
    };
    channel.onclose = () => {
      if (peerStatus === 'connected') peerStatus = 'closed';
    };
    channel.onerror = () => {
      peerStatus = 'failed';
      if (!errorMessage) errorMessage = 'Data channel error during transfer.';
    };
    channel.onmessage = (event) => handleDataMessage(event.data);
  }

  function handlePeerLeft() {
    errorMessage = 'The other device disconnected.';
    peerStatus = 'closed';
    closePeerConnection();
    for (const item of [...outgoing, ...incoming]) {
      if (item.status === 'active') item.status = 'error';
    }
  }

  function closePeerConnection() {
    dc?.close();
    pc?.close();
    dc = null;
    pc = null;
    pendingRemoteCandidates = [];
  }

  function resetConnectionState() {
    closePeerConnection();
    ws?.close();
    ws = null;
    wsStatus = 'idle';
    peerStatus = 'idle';
    errorMessage = '';
    outgoing = [];
    incoming = [];
    receiveBuffers.clear();
    pendingFiles = [];
    sendQueueBusy = false;
  }

  // ---- Sending ----

  function enqueueFiles(files: File[]) {
    pendingFiles.push(...files);
    void drainSendQueue();
  }

  async function drainSendQueue() {
    if (sendQueueBusy) return;
    sendQueueBusy = true;
    while (pendingFiles.length > 0) {
      const file = pendingFiles.shift()!;
      try {
        await sendFile(file);
      } catch {
        errorMessage = `Failed to send "${file.name}".`;
      }
    }
    sendQueueBusy = false;
  }

  function waitForBufferedLow(channel: RTCDataChannel): Promise<void> {
    return new Promise((resolve) => {
      const handler = () => {
        channel.removeEventListener('bufferedamountlow', handler);
        resolve();
      };
      channel.addEventListener('bufferedamountlow', handler);
    });
  }

  function updateRate(item: TransferItem) {
    const elapsedSec = Math.max((performance.now() - item.startedAt) / 1000, 0.05);
    item.rateBps = item.bytesDone / elapsedSec;
  }

  async function sendFile(file: File) {
    if (!dc || dc.readyState !== 'open') {
      errorMessage = 'Not connected to the other device yet.';
      return;
    }
    const channel = dc;
    const id = crypto.randomUUID();
    const mime = file.type || 'application/octet-stream';
    outgoing.push({
      id,
      name: file.name,
      size: file.size,
      mime,
      bytesDone: 0,
      direction: 'send',
      status: 'active',
      startedAt: performance.now(),
      rateBps: 0,
    });
    // Look the item back up from the reactive `outgoing` array (rather than
    // holding on to the plain object literal passed to `push`) before every
    // mutation below. Svelte 5's `$state` proxies wrap nested objects when
    // they're read back out of a reactive container; mutating the original,
    // pre-push reference instead bypasses that proxy, so the UI never
    // re-renders even though the transfer itself completes correctly. (The
    // receive path below already does this correctly via `incoming.find`.)
    const findItem = () => outgoing.find((t) => t.id === id)!;

    channel.send(JSON.stringify({ type: 'file-meta', id, name: file.name, size: file.size, mime }));

    const buffer = await file.arrayBuffer();
    let offset = 0;
    while (offset < buffer.byteLength) {
      if (channel.readyState !== 'open') {
        findItem().status = 'error';
        errorMessage = 'Connection dropped mid-transfer.';
        return;
      }
      if (channel.bufferedAmount > BUFFER_HIGH_WATER) {
        await waitForBufferedLow(channel);
      }
      const end = Math.min(offset + CHUNK_SIZE, buffer.byteLength);
      channel.send(buffer.slice(offset, end));
      offset = end;
      const current = findItem();
      current.bytesDone = offset;
      updateRate(current);
    }
    channel.send(JSON.stringify({ type: 'file-end', id }));
    const finished = findItem();
    finished.status = 'done';
    finished.bytesDone = finished.size;
  }

  // ---- Receiving ----

  function handleDataMessage(data: string | ArrayBuffer) {
    if (typeof data === 'string') {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.type === 'file-meta') {
        const id = String(msg.id);
        receiveBuffers.set(id, { chunks: [], received: 0 });
        incoming.push({
          id,
          name: String(msg.name ?? 'file'),
          size: Number(msg.size ?? 0),
          mime: String(msg.mime ?? 'application/octet-stream'),
          bytesDone: 0,
          direction: 'receive',
          status: 'active',
          startedAt: performance.now(),
          rateBps: 0,
        });
      } else if (msg.type === 'file-end') {
        finishReceive(String(msg.id));
      }
      return;
    }

    const active = incoming.find((t) => t.status === 'active');
    if (!active) return;
    const rec = receiveBuffers.get(active.id);
    if (!rec) return;
    rec.chunks.push(data);
    rec.received += data.byteLength;
    active.bytesDone = rec.received;
    updateRate(active);
  }

  function finishReceive(id: string) {
    const rec = receiveBuffers.get(id);
    const item = incoming.find((t) => t.id === id);
    if (!rec || !item) return;
    const blob = new Blob(rec.chunks as BlobPart[], { type: item.mime });
    receiveBuffers.delete(id);
    item.status = 'done';
    item.bytesDone = item.size || blob.size;
    triggerDownload(blob, item.name);
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  // ---- Session setup ----

  function hostSession() {
    role = 'host';
    code = generateCode();
    connectSignaling(code);
  }

  function joinSession(sessionCode: string) {
    role = 'joiner';
    code = sessionCode;
    connectSignaling(sessionCode);
  }

  function joinManually() {
    const trimmed = joinInput.trim().toUpperCase();
    if (!trimmed) return;
    joinSession(trimmed);
  }

  async function copyPairingLink() {
    if (!pairingUrl) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
    } catch {
      // Clipboard API unavailable or denied — the code/link are shown as text anyway.
    }
  }

  $effect(() => {
    if (role !== 'host' || !qrCanvas || !pairingUrl) return;
    QRCode.toCanvas(qrCanvas, pairingUrl, {
      width: 176,
      margin: 1,
      color: { dark: '#141413', light: '#ffffff' },
    }).catch(() => {
      errorMessage = errorMessage || 'Could not render the pairing QR code.';
    });
  });

  $effect(() => {
    if (wsStatus !== 'connecting') return;
    const timer = setTimeout(() => {
      if (wsStatus === 'connecting') {
        wsStatus = 'closed';
        peerStatus = 'failed';
        errorMessage = 'Could not reach the signaling server — it may not be deployed yet.';
      }
    }, 8000);
    return () => clearTimeout(timer);
  });

  onMount(() => {
    if (!supported) return;
    origin = `${window.location.origin}${window.location.pathname}`;
    const joinCode = new URLSearchParams(window.location.search).get('join');
    if (joinCode) {
      joinSession(joinCode.toUpperCase());
    } else {
      hostSession();
    }
  });

  onDestroy(() => {
    resetConnectionState();
  });
</script>

<div class="console">
  <div class="stage">
    <div class="silhouettes" class:active={peerStatus === 'connected'}>
      <div class="device" aria-hidden="true">
        <svg width="40" height="52" viewBox="0 0 40 52" fill="none">
          <rect x="1" y="1" width="38" height="50" rx="3" stroke="currentColor" stroke-width="1.5" />
          <rect x="8" y="6" width="24" height="34" stroke="currentColor" stroke-width="1.25" />
          <circle cx="20" cy="45.5" r="1.6" fill="currentColor" />
        </svg>
        <span class="device-label readout">{role === 'host' ? 'This device' : 'Sender'}</span>
      </div>
      <svg class="beam" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true">
        <line x1="2" y1="6" x2="118" y2="6" class="beam-track" />
        <line x1="2" y1="6" x2="118" y2="6" class="beam-pulse" />
      </svg>
      <div class="device" aria-hidden="true">
        <svg width="40" height="52" viewBox="0 0 40 52" fill="none">
          <rect x="1" y="1" width="38" height="50" rx="3" stroke="currentColor" stroke-width="1.5" />
          <rect x="8" y="6" width="24" height="34" stroke="currentColor" stroke-width="1.25" />
          <circle cx="20" cy="45.5" r="1.6" fill="currentColor" />
        </svg>
        <span class="device-label readout">{role === 'host' ? 'Peer' : 'This device'}</span>
      </div>
    </div>
    <div class="stage-hud">
      <Led state={ledState} label={ledLabel} />
      {#if anyTransferActive}
        <span class="readout hud-rate">
          {formatBytes([...outgoing, ...incoming].filter((t) => t.status === 'active').reduce((s, t) => s + t.rateBps, 0))}/s
        </span>
      {/if}
    </div>
  </div>

  {#if !supported}
    <p class="notice">
      Your browser doesn't support the WebRTC and WebSocket APIs File Drop needs. Try a recent version of Chrome,
      Firefox, Safari, or Edge.
    </p>
  {:else}
    <div class="pairing">
      {#if role === 'host'}
        <div class="qr-wrap">
          <canvas bind:this={qrCanvas} width="176" height="176"></canvas>
        </div>
        <div class="pairing-details">
          <p class="pairing-hint">Scan on the other device, or share the code:</p>
          <p class="code readout">{code || '——————'}</p>
          <button type="button" class="ghost-btn" onclick={copyPairingLink} disabled={!pairingUrl}>
            Copy pairing link
          </button>
          <details class="manual-join">
            <summary>Joining a session instead?</summary>
            <div class="manual-join-row">
              <label class="visually-hidden" for="join-code">Session code</label>
              <input
                id="join-code"
                type="text"
                inputmode="text"
                autocomplete="off"
                maxlength="8"
                placeholder="ABC123"
                bind:value={joinInput}
                onkeydown={(e) => e.key === 'Enter' && joinManually()}
              />
              <button type="button" class="ghost-btn" onclick={joinManually}>Join</button>
            </div>
          </details>
        </div>
      {:else}
        <p class="pairing-hint">
          Joining session <span class="readout code-inline">{code}</span>
          {#if peerStatus === 'waiting'}— waiting for the other device…{/if}
        </p>
      {/if}
    </div>

    {#if errorMessage}
      <p class="notice error" role="alert">{errorMessage}</p>
    {/if}

    <Dropzone
      multiple
      disabled={peerStatus !== 'connected'}
      onfiles={enqueueFiles}
      label={peerStatus === 'connected' ? 'Drop files here to send them' : 'Waiting for a connection before you can send files'}
      hint="Sent directly to the paired device — never uploaded to a server"
    />

    {#if outgoing.length > 0 || incoming.length > 0}
      <div class="transfers">
        {#each [...outgoing, ...incoming].slice().reverse() as t (t.id)}
          <ProgressReadout
            value={t.size > 0 ? t.bytesDone / t.size : t.status === 'done' ? 1 : 0}
            indeterminate={t.size === 0 && t.status === 'active'}
            label={`${t.direction === 'send' ? '↑ Sending' : '↓ Receiving'} ${t.name}`}
            detail={`${formatBytes(t.bytesDone)} / ${formatBytes(t.size)}${t.status === 'active' ? ` · ${formatBytes(t.rateBps)}/s` : t.status === 'done' ? ' · done' : ' · failed'}`}
          />
        {/each}
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

  .stage {
    position: relative;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    padding: var(--space-6) var(--space-5) var(--space-4);
    margin-bottom: var(--space-5);
  }

  .silhouettes {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    color: var(--fg-faint);
  }

  .silhouettes.active {
    color: var(--fg-soft);
  }

  .device {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  .device-label {
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }

  .beam {
    width: 100%;
    max-width: 220px;
    height: 12px;
    flex: 1;
  }

  .beam-track {
    stroke: var(--border-strong);
    stroke-width: 1;
  }

  .beam-pulse {
    stroke: var(--signal);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 10 110;
    stroke-dashoffset: 120;
    opacity: 0;
  }

  .silhouettes.active .beam-pulse {
    opacity: 1;
    animation: beam-travel 1.4s linear infinite;
  }

  @keyframes beam-travel {
    from {
      stroke-dashoffset: 120;
    }
    to {
      stroke-dashoffset: -120;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .silhouettes.active .beam-pulse {
      animation: none;
      opacity: 0.6;
      stroke-dasharray: none;
    }
  }

  .stage-hud {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: var(--space-4);
  }

  .hud-rate {
    font-size: var(--text-xs);
    color: var(--fg-soft);
  }

  .pairing {
    display: flex;
    gap: var(--space-5);
    align-items: flex-start;
    flex-wrap: wrap;
    margin-bottom: var(--space-4);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border);
  }

  .qr-wrap {
    border: 1px solid var(--border-strong);
    background: #ffffff;
    padding: var(--space-2);
    line-height: 0;
    flex: none;
  }

  .qr-wrap canvas {
    display: block;
    width: 128px;
    height: 128px;
  }

  .pairing-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 200px;
  }

  .pairing-hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--fg-soft);
  }

  .code {
    margin: 0;
    font-size: var(--text-xl);
    letter-spacing: 0.12em;
  }

  .code-inline {
    font-size: var(--text-md);
    letter-spacing: 0.08em;
  }

  .ghost-btn {
    align-self: flex-start;
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--fg);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: border-color var(--duration-tick) var(--ease-snap), color var(--duration-tick) var(--ease-snap);
  }

  .ghost-btn:hover:not(:disabled) {
    border-color: var(--signal-text);
    color: var(--signal-text);
  }

  .ghost-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .manual-join {
    margin-top: var(--space-1);
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }

  .manual-join summary {
    cursor: pointer;
  }

  .manual-join-row {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .manual-join-row input {
    background: var(--bg);
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    width: 9ch;
  }

  .notice {
    font-size: var(--text-sm);
    color: var(--fg-soft);
    border: 1px solid var(--border-strong);
    background: var(--bg);
    padding: var(--space-4);
    margin: 0 0 var(--space-4);
  }

  .notice.error {
    color: var(--signal-text);
    border-color: var(--signal-text);
  }

  .transfers {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-top: var(--space-5);
  }
</style>

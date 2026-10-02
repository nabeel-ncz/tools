<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import QRCode from 'qrcode';
  import Led from '../../design/primitives/Led.svelte';

  type WsStatus = 'idle' | 'connecting' | 'open' | 'closed';
  type PeerStatus = 'idle' | 'waiting' | 'negotiating' | 'connected' | 'closed' | 'failed';
  type Role = 'host' | 'joiner' | null;

  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const MAX_CHARS = 200_000;
  const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  const supported =
    typeof window !== 'undefined' &&
    !!window.RTCPeerConnection &&
    !!window.WebSocket &&
    !!window.crypto?.getRandomValues;

  let role = $state<Role>(null);
  let code = $state('');
  let origin = $state('');
  let wsStatus = $state<WsStatus>('idle');
  let peerStatus = $state<PeerStatus>('idle');
  let errorMessage = $state('');
  let text = $state('');
  let copied = $state(false);
  let linkCopied = $state(false);
  let showPairing = $state(true);
  let qrCanvas: HTMLCanvasElement | undefined = $state();
  let textarea: HTMLTextAreaElement | undefined = $state();

  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  // Last-writer-wins clock: every local edit stamps Date.now(); a remote
  // update is applied only if it is newer than the last one we applied/sent.
  let lastStamp = 0;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  const pairingUrl = $derived(code && origin ? `${origin}?join=${code}` : '');
  const connected = $derived(peerStatus === 'connected');

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
        return 'Connected — live';
      case 'negotiating':
        return 'Negotiating';
      case 'waiting':
        return 'Waiting for the other device';
      case 'failed':
        return 'Connection failed';
      case 'closed':
        return 'Other device left';
      default:
        return wsStatus === 'connecting' ? 'Connecting' : 'Idle';
    }
  });

  function generateCode(length = 6): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }

  function signalingUrl(sessionCode: string): string {
    const envUrl = import.meta.env.PUBLIC_SIGNALING_URL;
    // PUBLIC_SIGNALING_URL is shared with File Drop and ends in /ws/filedrop;
    // the Worker serves /ws/notepad/<code> from the same deployment.
    if (envUrl) return `${envUrl.replace(/\/$/, '').replace(/\/ws\/filedrop$/, '')}/ws/notepad/${sessionCode}`;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws/notepad/${sessionCode}`;
  }

  function sendSignal(payload: Record<string, unknown>) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
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
        errorMessage = 'The other device disconnected.';
        peerStatus = 'closed';
        closePeerConnection();
        return;
      case 'error':
        errorMessage = typeof msg.message === 'string' ? msg.message : 'Signaling server rejected a message.';
        return;
    }
    if (msg.kind === 'sdp') void handleRemoteSdp(msg as { sdpType: RTCSdpType; sdp: string });
    else if (msg.kind === 'ice') void handleRemoteIce((msg.candidate ?? null) as RTCIceCandidateInit | null);
  }

  function ensurePeerConnection(): RTCPeerConnection {
    if (pc) return pc;
    const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    conn.onicecandidate = (event) => {
      if (event.candidate) sendSignal({ kind: 'ice', candidate: event.candidate.toJSON() });
    };
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === 'failed' || conn.connectionState === 'disconnected') {
        peerStatus = 'failed';
        if (!errorMessage) errorMessage = 'Connection lost. Reload both devices to pair again.';
      }
    };
    conn.ondatachannel = (event) => setupDataChannel(event.channel);
    pc = conn;
    return conn;
  }

  async function startAsHost() {
    const conn = ensurePeerConnection();
    setupDataChannel(conn.createDataChannel('notepad', { ordered: true }));
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
      for (const candidate of pendingRemoteCandidates.splice(0)) {
        await conn.addIceCandidate(candidate).catch(() => {});
      }
    } catch {
      peerStatus = 'failed';
      errorMessage = 'Could not negotiate the connection.';
    }
  }

  async function handleRemoteIce(candidate: RTCIceCandidateInit | null) {
    if (!candidate) return;
    if (pc && pc.remoteDescription) await pc.addIceCandidate(candidate).catch(() => {});
    else pendingRemoteCandidates.push(candidate);
  }

  function setupDataChannel(channel: RTCDataChannel) {
    dc = channel;
    channel.onopen = () => {
      peerStatus = 'connected';
      errorMessage = '';
      showPairing = false;
      // Hand over whatever we already have so a late joiner sees the note.
      if (text) sendText();
    };
    channel.onclose = () => {
      if (peerStatus === 'connected') peerStatus = 'closed';
    };
    channel.onerror = () => {
      peerStatus = 'failed';
      if (!errorMessage) errorMessage = 'Connection error.';
    };
    channel.onmessage = (event) => handleRemote(event.data);
  }

  function sendText() {
    if (dc?.readyState !== 'open') return;
    dc.send(JSON.stringify({ type: 'text', text, stamp: lastStamp }));
  }

  function handleRemote(data: unknown) {
    if (typeof data !== 'string') return;
    let msg: { type?: string; text?: unknown; stamp?: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type !== 'text' || typeof msg.text !== 'string' || typeof msg.stamp !== 'number') return;
    if (msg.stamp < lastStamp) return; // our own edit is newer — keep it
    lastStamp = msg.stamp;
    const next = msg.text.slice(0, MAX_CHARS);
    const start = textarea?.selectionStart ?? 0;
    const end = textarea?.selectionEnd ?? 0;
    text = next;
    // Keep the caret where it was instead of jumping to the end.
    queueMicrotask(() => {
      if (textarea && document.activeElement === textarea) {
        textarea.setSelectionRange(Math.min(start, next.length), Math.min(end, next.length));
      }
    });
  }

  function onInput() {
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    sendText();
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
  }

  async function copyText() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      textarea?.select();
      document.execCommand?.('copy');
    }
    copied = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1500);
  }

  async function copyLink() {
    if (!pairingUrl) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
      linkCopied = true;
      setTimeout(() => (linkCopied = false), 1500);
    } catch {
      // The link is also visible as text.
    }
  }

  function clearText() {
    text = '';
    onInput();
    textarea?.focus();
  }

  $effect(() => {
    if (role !== 'host' || !qrCanvas || !pairingUrl || !showPairing) return;
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
      role = 'joiner';
      code = joinCode.toUpperCase();
      showPairing = false;
    } else {
      role = 'host';
      code = generateCode();
    }
    connectSignaling(code);
    textarea?.focus();
  });

  onDestroy(() => {
    clearTimeout(copyTimer);
    resetConnectionState();
  });
</script>

<div class="console">
  <div class="bar">
    <Led state={ledState} label={ledLabel} />
    <div class="actions">
      {#if role === 'host' && !connected}
        <button type="button" class="ghost-btn" onclick={() => (showPairing = !showPairing)}>
          {showPairing ? 'Hide pairing' : 'Show pairing'}
        </button>
      {/if}
      <button type="button" class="ghost-btn" onclick={clearText} disabled={!text}>Clear</button>
      <button type="button" class="ghost-btn primary" onclick={copyText} disabled={!text}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  </div>

  {#if !supported}
    <p class="notice">
      Your browser doesn't support the WebRTC and WebSocket APIs Shared Notepad needs. Try a recent version of
      Chrome, Firefox, Safari, or Edge.
    </p>
  {:else}
    {#if role === 'host' && showPairing && !connected}
      <div class="pairing">
        <div class="qr-wrap">
          <canvas bind:this={qrCanvas} width="176" height="176"></canvas>
        </div>
        <div class="pairing-details">
          <p class="pairing-hint">Scan on the other device, or open the link there:</p>
          <p class="code readout">{code || '——————'}</p>
          <button type="button" class="ghost-btn" onclick={copyLink} disabled={!pairingUrl}>
            {linkCopied ? 'Link copied' : 'Copy pairing link'}
          </button>
        </div>
      </div>
    {:else if role === 'joiner' && !connected && peerStatus !== 'failed'}
      <p class="pairing-hint joiner">
        Joining <span class="readout">{code}</span>… connecting to the other device.
      </p>
    {/if}

    {#if errorMessage}
      <p class="notice error" role="alert">{errorMessage}</p>
    {/if}

    <label class="visually-hidden" for="note">Shared note</label>
    <textarea
      id="note"
      bind:this={textarea}
      bind:value={text}
      oninput={onInput}
      spellcheck="false"
      autocomplete="off"
      placeholder={connected ? 'Type or paste here — the other device sees it instantly.' : 'Start typing or paste here. It will sync once the other device connects.'}
    ></textarea>
    <div class="foot readout">
      <span>{text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters</span>
      <span>{connected ? 'Synced peer-to-peer' : 'Not synced yet'}</span>
    </div>
  {/if}
</div>

<style>
  .console {
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-5);
  }

  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }

  .ghost-btn {
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

  .ghost-btn.primary {
    min-width: 5.5rem;
  }

  .ghost-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
    align-items: flex-start;
  }

  .pairing-hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--fg-soft);
  }

  .pairing-hint.joiner {
    margin-bottom: var(--space-4);
  }

  .code {
    margin: 0;
    font-size: var(--text-xl);
    letter-spacing: 0.12em;
  }

  textarea {
    display: block;
    width: 100%;
    min-height: 55vh;
    resize: vertical;
    box-sizing: border-box;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-md);
    line-height: 1.6;
  }

  textarea:focus-visible {
    outline: 2px solid var(--signal-text);
    outline-offset: 1px;
  }

  .foot {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    color: var(--fg-faint);
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
</style>

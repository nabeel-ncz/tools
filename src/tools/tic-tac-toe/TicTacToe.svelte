<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import QRCode from 'qrcode';
  import Led from '../../design/primitives/Led.svelte';
  import { emptyBoard, outcome, turnFor, type Cell, type Mark } from './game';

  type Mode = 'lobby' | 'local' | 'online';
  type WsStatus = 'idle' | 'connecting' | 'open' | 'closed';
  type PeerStatus = 'idle' | 'waiting' | 'negotiating' | 'connected' | 'closed' | 'failed';
  type Role = 'host' | 'joiner' | null;

  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1 — easy to read aloud
  const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  const onlineSupported =
    typeof window !== 'undefined' &&
    !!window.RTCPeerConnection &&
    !!window.WebSocket &&
    !!window.crypto?.getRandomValues;

  let mode = $state<Mode>('lobby');
  let role = $state<Role>(null);
  let code = $state('');
  let origin = $state('');
  let joinInput = $state('');
  let wsStatus = $state<WsStatus>('idle');
  let peerStatus = $state<PeerStatus>('idle');
  let errorMessage = $state('');
  let copied = $state(false);
  let qrCanvas: HTMLCanvasElement | undefined = $state();

  let board = $state<Cell[]>(emptyBoard());
  let round = $state(1);
  let score = $state({ X: 0, O: 0, draw: 0 });

  let cellButtons: HTMLButtonElement[] = $state([]);

  // Plain (non-reactive) connection internals — status fields above drive the UI.
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let pendingRemoteCandidates: RTCIceCandidateInit[] = [];

  // In an online game the host is always X and the joiner O.
  const myMark = $derived<Mark | null>(mode === 'online' ? (role === 'host' ? 'X' : 'O') : null);
  const result = $derived(outcome(board));
  const gameOver = $derived(!!result.winner || result.draw);
  const turn = $derived(turnFor(board, round));
  const pairingUrl = $derived(code && origin ? `${origin}?join=${code}` : '');
  const connected = $derived(peerStatus === 'connected');

  const canPlay = $derived(
    !gameOver && (mode === 'local' || (mode === 'online' && connected && turn === myMark)),
  );

  const statusText = $derived.by(() => {
    if (mode === 'online' && !connected) {
      if (peerStatus === 'closed') return 'Your opponent left.';
      if (peerStatus === 'failed') return 'Not connected.';
      return 'Waiting for an opponent…';
    }
    if (result.winner) {
      if (mode === 'local') return `${result.winner} wins!`;
      return result.winner === myMark ? 'You win!' : 'You lose.';
    }
    if (result.draw) return 'Draw.';
    if (mode === 'local') return `${turn} to play`;
    return turn === myMark ? `Your turn — you're ${myMark}` : `Waiting for ${turn}…`;
  });

  const ledState = $derived.by((): 'off' | 'ready' | 'live' | 'error' => {
    if (peerStatus === 'connected') return 'live';
    if (peerStatus === 'failed') return 'error';
    if (wsStatus === 'connecting' || peerStatus === 'waiting' || peerStatus === 'negotiating') return 'ready';
    return 'off';
  });

  const ledLabel = $derived.by(() => {
    switch (peerStatus) {
      case 'connected':
        return 'Connected';
      case 'negotiating':
        return 'Connecting to opponent';
      case 'waiting':
        return 'Waiting for opponent';
      case 'failed':
        return 'Connection failed';
      case 'closed':
        return 'Opponent left';
      default:
        return wsStatus === 'connecting' ? 'Connecting' : 'Idle';
    }
  });

  function generateCode(length = 6): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }

  // ---- Game ----

  function resetMatch() {
    board = emptyBoard();
    round = 1;
    score = { X: 0, O: 0, draw: 0 };
  }

  function placeMark(index: number, mark: Mark) {
    board[index] = mark;
    const after = outcome(board);
    if (after.winner) score[after.winner] += 1;
    else if (after.draw) score.draw += 1;
  }

  function startRound(next: number) {
    round = next;
    board = emptyBoard();
  }

  function play(index: number) {
    if (!canPlay || board[index]) return;
    const mark = turn;
    placeMark(index, mark);
    if (mode === 'online') sendData({ type: 'move', round, index });
  }

  function playAgain() {
    if (!gameOver) return;
    const next = round + 1;
    startRound(next);
    if (mode === 'online') sendData({ type: 'new-round', round: next });
    void tick().then(() => cellButtons[4]?.focus());
  }

  function handleCellKey(event: KeyboardEvent, index: number) {
    const row = Math.floor(index / 3);
    const col = index % 3;
    let target: number | null = null;
    if (event.key === 'ArrowUp') target = ((row + 2) % 3) * 3 + col;
    else if (event.key === 'ArrowDown') target = ((row + 1) % 3) * 3 + col;
    else if (event.key === 'ArrowLeft') target = row * 3 + ((col + 2) % 3);
    else if (event.key === 'ArrowRight') target = row * 3 + ((col + 1) % 3);
    if (target === null) return;
    event.preventDefault();
    cellButtons[target]?.focus();
  }

  function cellLabel(index: number): string {
    const position = `Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}`;
    return `${position}: ${board[index] ?? 'empty'}`;
  }

  // ---- Peer messages (over the WebRTC data channel, never the server) ----

  function sendData(payload: Record<string, unknown>) {
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(payload));
  }

  function handleDataMessage(raw: unknown) {
    if (typeof raw !== 'string' || !myMark) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const opponent: Mark = myMark === 'X' ? 'O' : 'X';

    if (msg.type === 'move') {
      const index = Number(msg.index);
      // Both sides apply the same rules, so anything out of turn or onto a
      // taken square is simply ignored rather than trusted.
      if (msg.round !== round || !Number.isInteger(index) || index < 0 || index > 8) return;
      if (gameOver || board[index] || turn !== opponent) return;
      placeMark(index, opponent);
    } else if (msg.type === 'new-round') {
      // If both players press "Play again" at once, each has already moved
      // to that round, so the duplicate is ignored.
      if (msg.round === round + 1 && gameOver) startRound(round + 1);
    }
  }

  // ---- Signaling + WebRTC (same flow as File Drop) ----

  function signalingUrl(sessionCode: string): string {
    const envUrl = import.meta.env.PUBLIC_SIGNALING_URL;
    // PUBLIC_SIGNALING_URL is shared with File Drop and ends in /ws/filedrop;
    // the same Worker serves /ws/tictactoe/<code> for this game.
    if (envUrl) return `${envUrl.replace(/\/$/, '').replace(/\/ws\/filedrop$/, '')}/ws/tictactoe/${sessionCode}`;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws/tictactoe/${sessionCode}`;
  }

  function sendSignal(payload: Record<string, unknown>) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function connectSignaling(sessionCode: string) {
    disconnect();
    wsStatus = 'connecting';
    let socket: WebSocket;
    try {
      socket = new WebSocket(signalingUrl(sessionCode));
    } catch {
      wsStatus = 'closed';
      peerStatus = 'failed';
      errorMessage = 'Could not reach the game server.';
      return;
    }
    ws = socket;
    let opened = false;

    socket.addEventListener('open', () => {
      opened = true;
      wsStatus = 'open';
      peerStatus = 'waiting';
    });
    socket.addEventListener('message', (event) => handleSignal(event.data));
    socket.addEventListener('close', () => {
      if (ws !== socket) return;
      wsStatus = 'closed';
      if (peerStatus !== 'connected') {
        peerStatus = 'failed';
        if (!errorMessage) {
          errorMessage = opened
            ? 'Lost the connection to the game server.'
            : 'Could not join — the game may already have two players, or the server is unreachable.';
        }
      }
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
        // The server decides who plays X: whoever is in the room first. A
        // join link opened after the host has gone simply hosts that room.
        role = msg.role === 'host' ? 'host' : 'joiner';
        return;
      case 'peer-joined':
        if (role === 'host') {
          closePeerConnection();
          peerStatus = 'negotiating';
          errorMessage = '';
          void startAsHost();
        }
        return;
      case 'peer-left':
        closePeerConnection();
        // The host keeps the room open for a new opponent; a joiner whose
        // host left has nobody to wait for.
        peerStatus = role === 'host' && wsStatus === 'open' ? 'waiting' : 'closed';
        errorMessage = 'Your opponent left the game.';
        return;
      case 'error':
        errorMessage = typeof msg.message === 'string' ? msg.message : 'The game server rejected a message.';
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
      if (event.candidate) sendSignal({ kind: 'ice', candidate: event.candidate.toJSON() });
    };
    conn.onconnectionstatechange = () => {
      if (pc !== conn) return;
      if (conn.connectionState === 'failed' || conn.connectionState === 'disconnected') {
        peerStatus = 'failed';
        if (!errorMessage) errorMessage = 'Connection to your opponent was lost.';
      }
    };
    conn.ondatachannel = (event) => setupDataChannel(event.channel);
    pc = conn;
    return conn;
  }

  async function startAsHost() {
    const conn = ensurePeerConnection();
    setupDataChannel(conn.createDataChannel('tictactoe', { ordered: true }));
    try {
      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      sendSignal({ kind: 'sdp', sdpType: 'offer', sdp: conn.localDescription?.sdp });
    } catch {
      peerStatus = 'failed';
      errorMessage = 'Could not start the connection.';
    }
  }

  async function handleRemoteSdp(msg: { sdpType: RTCSdpType; sdp: string }) {
    const conn = ensurePeerConnection();
    try {
      await conn.setRemoteDescription({ type: msg.sdpType, sdp: msg.sdp });
      if (msg.sdpType === 'offer') {
        peerStatus = 'negotiating';
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);
        sendSignal({ kind: 'sdp', sdpType: 'answer', sdp: conn.localDescription?.sdp });
      }
      for (const candidate of pendingRemoteCandidates.splice(0)) {
        await conn.addIceCandidate(candidate).catch(() => {});
      }
    } catch {
      peerStatus = 'failed';
      errorMessage = 'Could not connect to your opponent.';
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
    channel.onopen = () => {
      if (dc !== channel) return;
      // Every new opponent starts a fresh match.
      resetMatch();
      peerStatus = 'connected';
      errorMessage = '';
    };
    channel.onclose = () => {
      if (dc === channel && peerStatus === 'connected') peerStatus = 'closed';
    };
    channel.onmessage = (event) => handleDataMessage(event.data);
  }

  function closePeerConnection() {
    dc?.close();
    pc?.close();
    dc = null;
    pc = null;
    pendingRemoteCandidates = [];
  }

  function disconnect() {
    closePeerConnection();
    const socket = ws;
    ws = null;
    socket?.close();
    wsStatus = 'idle';
    peerStatus = 'idle';
    errorMessage = '';
  }

  // ---- Lobby actions ----

  function hostGame() {
    mode = 'online';
    role = 'host';
    code = generateCode();
    resetMatch();
    connectSignaling(code);
  }

  function joinGame(sessionCode: string) {
    mode = 'online';
    role = 'joiner';
    code = sessionCode;
    resetMatch();
    connectSignaling(sessionCode);
  }

  function joinManually() {
    const trimmed = joinInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(trimmed)) {
      errorMessage = 'Enter the 6-character game code from the other player.';
      return;
    }
    joinGame(trimmed);
  }

  function playLocal() {
    disconnect();
    mode = 'local';
    role = null;
    resetMatch();
  }

  function leave() {
    disconnect();
    mode = 'lobby';
    role = null;
    code = '';
    joinInput = '';
    resetMatch();
    // Drop ?join= so a reload doesn't rejoin a game you just left.
    if (window.location.search) history.replaceState(null, '', window.location.pathname);
  }

  async function copyLink() {
    if (!pairingUrl) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard unavailable — the code and link are shown as text anyway.
    }
  }

  $effect(() => {
    if (role !== 'host' || connected || !qrCanvas || !pairingUrl) return;
    QRCode.toCanvas(qrCanvas, pairingUrl, {
      width: 176,
      margin: 1,
      color: { dark: '#141413', light: '#ffffff' },
    }).catch(() => {});
  });

  $effect(() => {
    if (wsStatus !== 'connecting') return;
    const timer = setTimeout(() => {
      if (wsStatus === 'connecting') {
        disconnect();
        wsStatus = 'closed';
        peerStatus = 'failed';
        errorMessage = 'Could not reach the game server — it may not be deployed yet. Pass & play still works.';
      }
    }, 8000);
    return () => clearTimeout(timer);
  });

  onMount(() => {
    origin = `${window.location.origin}${window.location.pathname}`;
    const joinCode = new URLSearchParams(window.location.search).get('join');
    if (joinCode && onlineSupported) joinGame(joinCode.trim().toUpperCase());
  });

  onDestroy(() => {
    disconnect();
  });
</script>

<div class="console">
  {#if mode === 'lobby'}
    <div class="lobby">
      <section class="lobby-card" aria-labelledby="ttt-online">
        <h2 id="ttt-online" class="lobby-title">Play online</h2>
        <p class="lobby-hint">Start a game and send the link or code to a friend on another device.</p>
        {#if onlineSupported}
          <button type="button" class="primary-btn" onclick={hostGame}>Start a game</button>
          <div class="join-row">
            <label class="visually-hidden" for="ttt-join-code">Game code</label>
            <input
              id="ttt-join-code"
              type="text"
              inputmode="text"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              maxlength="8"
              placeholder="ABC123"
              bind:value={joinInput}
              onkeydown={(e) => e.key === 'Enter' && joinManually()}
            />
            <button type="button" class="ghost-btn" onclick={joinManually}>Join</button>
          </div>
        {:else}
          <p class="notice">
            Your browser doesn't support the WebRTC and WebSocket APIs online play needs. Pass & play still works.
          </p>
        {/if}
      </section>
      <section class="lobby-card" aria-labelledby="ttt-local">
        <h2 id="ttt-local" class="lobby-title">Pass &amp; play</h2>
        <p class="lobby-hint">Two players taking turns on this device. Works offline.</p>
        <button type="button" class="ghost-btn" onclick={playLocal}>Play on this device</button>
      </section>
    </div>
    {#if errorMessage}
      <p class="notice error" role="alert">{errorMessage}</p>
    {/if}
  {:else}
    <div class="topbar">
      {#if mode === 'online'}
        <Led state={ledState} label={ledLabel} />
      {:else}
        <span class="readout mode-label">Pass &amp; play</span>
      {/if}
      <button type="button" class="link-btn" onclick={leave}>Leave game</button>
    </div>

    {#if mode === 'online' && !connected && role === 'host' && peerStatus !== 'failed'}
      <div class="pairing">
        <div class="qr-wrap">
          <canvas bind:this={qrCanvas} width="176" height="176"></canvas>
        </div>
        <div class="pairing-details">
          <p class="pairing-hint">Scan on the other device, or share the code:</p>
          <p class="code readout">{code}</p>
          <button type="button" class="ghost-btn" onclick={copyLink} disabled={!pairingUrl}>
            {copied ? 'Link copied' : 'Copy invite link'}
          </button>
          <p class="pairing-hint">You play X.</p>
        </div>
      </div>
    {:else if mode === 'online' && !connected && role === 'joiner' && peerStatus !== 'failed' && peerStatus !== 'closed'}
      <p class="pairing-hint joining">
        Joining game <span class="readout code-inline">{code}</span>…
      </p>
    {/if}

    {#if errorMessage}
      <p class="notice error" role="alert">{errorMessage}</p>
    {/if}

    {#if mode === 'online' && (peerStatus === 'failed' || (peerStatus === 'closed' && role === 'joiner'))}
      <div class="actions">
        <button type="button" class="primary-btn" onclick={hostGame}>Start a new game</button>
        <button type="button" class="ghost-btn" onclick={playLocal}>Pass &amp; play instead</button>
      </div>
    {/if}

    {#if mode === 'local' || connected}
      <div class="scoreboard" aria-label="Score">
        <div class="score" class:active={!gameOver && turn === 'X'}>
          <span class="score-mark">X{mode === 'online' && myMark === 'X' ? ' · you' : ''}</span>
          <span class="readout score-value">{score.X}</span>
        </div>
        <div class="score">
          <span class="score-mark">Draws</span>
          <span class="readout score-value">{score.draw}</span>
        </div>
        <div class="score" class:active={!gameOver && turn === 'O'}>
          <span class="score-mark">O{mode === 'online' && myMark === 'O' ? ' · you' : ''}</span>
          <span class="readout score-value">{score.O}</span>
        </div>
      </div>

      <p class="status" aria-live="polite">{statusText}</p>

      <div class="board" role="group" aria-label="Tic tac toe board">
        {#each board as cell, i}
          <button
            type="button"
            class="cell"
            class:win={result.line.includes(i)}
            class:playable={canPlay && !cell}
            aria-label={cellLabel(i)}
            aria-disabled={!canPlay || !!cell}
            bind:this={cellButtons[i]}
            onclick={() => play(i)}
            onkeydown={(e) => handleCellKey(e, i)}
          >
            {#if cell === 'X'}
              <svg viewBox="0 0 40 40" aria-hidden="true" class="mark">
                <line x1="9" y1="9" x2="31" y2="31" pathLength="1" />
                <line x1="31" y1="9" x2="9" y2="31" pathLength="1" class="second" />
              </svg>
            {:else if cell === 'O'}
              <svg viewBox="0 0 40 40" aria-hidden="true" class="mark">
                <circle cx="20" cy="20" r="12" pathLength="1" />
              </svg>
            {/if}
          </button>
        {/each}
      </div>

      {#if gameOver}
        <div class="actions center">
          <button type="button" class="primary-btn" onclick={playAgain}>Play again</button>
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .console {
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    padding: var(--space-5);
  }

  .lobby {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-4);
  }

  .lobby-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    border: 1px solid var(--border-strong);
    background: var(--bg);
    padding: var(--space-5);
  }

  .lobby-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: 500;
  }

  .lobby-hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--fg-soft);
  }

  .join-row {
    display: flex;
    gap: var(--space-2);
  }

  .join-row input {
    background: var(--bg);
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    width: 10ch;
    color: var(--fg);
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border);
  }

  .mode-label {
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-faint);
  }

  .link-btn {
    background: none;
    border: none;
    padding: var(--space-1) 0;
    font-size: var(--text-sm);
    color: var(--fg-soft);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .link-btn:hover {
    color: var(--signal-text);
  }

  .pairing {
    display: flex;
    gap: var(--space-5);
    align-items: flex-start;
    flex-wrap: wrap;
    margin-bottom: var(--space-4);
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

  .joining {
    margin-bottom: var(--space-4);
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

  .primary-btn,
  .ghost-btn {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-strong);
    transition:
      border-color var(--duration-tick) var(--ease-snap),
      color var(--duration-tick) var(--ease-snap),
      background var(--duration-tick) var(--ease-snap);
  }

  .primary-btn {
    background: var(--fg);
    color: var(--bg);
  }

  .primary-btn:hover {
    background: var(--signal);
    border-color: var(--signal);
    color: var(--signal-fg);
  }

  .ghost-btn {
    align-self: flex-start;
    background: transparent;
    color: var(--fg);
  }

  .ghost-btn:hover:not(:disabled) {
    border-color: var(--signal-text);
    color: var(--signal-text);
  }

  .ghost-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .actions {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-bottom: var(--space-4);
  }

  .actions.center {
    justify-content: center;
    margin: var(--space-5) 0 0;
  }

  .notice {
    font-size: var(--text-sm);
    color: var(--fg-soft);
    border: 1px solid var(--border-strong);
    background: var(--bg);
    padding: var(--space-4);
    margin: var(--space-4) 0;
  }

  .notice.error {
    color: var(--signal-text);
    border-color: var(--signal-text);
  }

  .scoreboard {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    max-width: 360px;
    margin: 0 auto var(--space-4);
    border: 1px solid var(--border-strong);
    background: var(--bg);
  }

  .score {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border-bottom: 2px solid transparent;
  }

  .score + .score {
    border-left: 1px solid var(--border);
  }

  .score.active {
    border-bottom-color: var(--signal);
  }

  .score-mark {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-faint);
  }

  .score-value {
    font-size: var(--text-lg);
  }

  .status {
    text-align: center;
    font-family: var(--font-display);
    font-size: var(--text-lg);
    margin: 0 0 var(--space-4);
  }

  .board {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    width: min(100%, 360px);
    aspect-ratio: 1;
    margin: 0 auto;
    border: 1px solid var(--border-strong);
    background: var(--border-strong);
    gap: 1px;
  }

  .cell {
    display: grid;
    place-items: center;
    background: var(--bg);
    border: none;
    padding: 0;
    color: var(--fg);
    cursor: default;
    transition: background var(--duration-tick) var(--ease-snap);
  }

  .cell.playable {
    cursor: pointer;
  }

  .cell.playable:hover {
    background: var(--bg-raised);
  }

  .cell:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -4px;
  }

  .cell.win {
    color: var(--signal-text);
  }

  .mark {
    width: 62%;
    height: 62%;
    fill: none;
    stroke: currentColor;
    stroke-width: 3.5;
    stroke-linecap: round;
  }

  .mark line,
  .mark circle {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: draw var(--duration-snap) var(--ease-snap) forwards;
  }

  .mark .second {
    animation-delay: var(--duration-snap);
  }

  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .mark line,
    .mark circle {
      animation: none;
      stroke-dashoffset: 0;
    }
  }
</style>

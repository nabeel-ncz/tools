import { loadAll, putPeer, putMsg, delPeer, delMsgsFor, lsGet, lsSet, type Peer, type Msg } from './store';

export type { Peer, Msg };

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1 — easy to read aloud
const KEY_RE = /^[A-HJKMNP-Z2-9]{8}$/;
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const CHUNK_SIZE = 16 * 1024;
const BUFFER_HIGH = 1024 * 1024;
const BUFFER_LOW = 256 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const KEEP_ORIGINAL_UNDER = 1.2 * 1024 * 1024;
const MAX_IMAGE_DIM = 2048;
const STALE_LINK_MS = 20_000;

export type HubState = 'connecting' | 'online' | 'offline' | 'replaced';
export type LinkState = 'idle' | 'connecting' | 'connected';

interface Link {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  making: boolean;
  ignoreOffer: boolean;
  pendingIce: RTCIceCandidateInit[];
  startedAt: number;
  flushing: boolean;
  recv: { meta: { id: string; ts: number; mime: string; name: string }; chunks: ArrayBuffer[] } | null;
}

interface Stash {
  offer: Record<string, any> | null;
  ice: RTCIceCandidateInit[];
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function formatKey(key: string): string {
  return key.length === 8 ? `${key.slice(0, 4)}-${key.slice(4)}` : key;
}

/** Accepts "abcd-efgh", "ABCD EFGH" or a full share link; returns key (+ pairing token). */
export function parseKeyInput(raw: string): { key: string; tok?: string } | null {
  let text = raw.trim();
  let tok: string | undefined;
  if (/add=/i.test(text)) {
    try {
      const url = new URL(text, window.location.origin);
      text = url.searchParams.get('add') ?? '';
      tok = url.searchParams.get('t') ?? undefined;
    } catch {
      // fall through and treat as plain text
    }
  }
  const key = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!KEY_RE.test(key)) return null;
  return { key, tok: tok && /^[A-Z0-9]{4,16}$/i.test(tok) ? tok.toUpperCase() : undefined };
}

function guessDeviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows PC'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux PC'
                : 'My device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  return browser ? `${os} · ${browser}` : os;
}

function signalingBase(): string {
  const envUrl = import.meta.env.PUBLIC_SIGNALING_URL;
  // PUBLIC_SIGNALING_URL is shared with File Drop and ends in /ws/filedrop;
  // the same Worker serves /ws/hub/<key> for Shared Notepad.
  if (envUrl) return envUrl.replace(/\/$/, '').replace(/\/ws\/filedrop$/, '');
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}`;
}

/** Downscale big photos so they send fast; small images and GIF/SVG pass through untouched. */
async function prepareImage(file: File): Promise<{ blob: Blob; mime: string; name: string }> {
  const keep = { blob: file as Blob, mime: file.type || 'image/png', name: file.name || 'image' };
  if (file.size <= KEEP_ORIGINAL_UNDER || /gif|svg/.test(file.type)) return keep;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
    if (out && out.size < file.size) {
      return { blob: out, mime: 'image/jpeg', name: (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg' };
    }
  } catch {
    // undecodable here — send the original
  }
  return keep;
}

export class NotepadEngine {
  myKey = $state('');
  myName = $state('');
  myToken = $state('');
  hub = $state<HubState>('connecting');
  ready = $state(false);
  persistent = $state(true);
  peers = $state<Peer[]>([]);
  messages = $state<Record<string, Msg[]>>({});
  online = $state<Record<string, boolean>>({});
  link = $state<Record<string, LinkState>>({});
  declinedBy = $state<Record<string, boolean>>({});
  active = $state<string | null>(null);
  notice = $state('');

  private ws: WebSocket | null = null;
  private links = new Map<string, Link>();
  private stash = new Map<string, Stash>();
  private backoff = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  get requests(): Peer[] {
    return this.peers.filter((p) => !p.accepted && !p.declined);
  }

  displayName(p: Peer): string {
    return p.nickname || p.theirName || `Device ${formatKey(p.key)}`;
  }

  // ---- Lifecycle ----

  async start() {
    this.stopped = false;
    let key = lsGet('nabl-notepad-key') ?? '';
    if (!KEY_RE.test(key)) {
      key = randomString(8);
      lsSet('nabl-notepad-key', key);
    }
    this.myKey = key;
    this.myName = lsGet('nabl-notepad-name') || guessDeviceName();
    let token = lsGet('nabl-notepad-token') ?? '';
    if (!/^[A-Z0-9]{8}$/.test(token)) {
      token = randomString(8);
      lsSet('nabl-notepad-token', token);
    }
    this.myToken = token;

    const { peers, msgs } = await loadAll();
    this.persistent = typeof indexedDB !== 'undefined';
    const grouped: Record<string, Msg[]> = {};
    for (const m of msgs.sort((a, b) => a.ts - b.ts)) (grouped[m.peer] ??= []).push(m);
    // Anything not acknowledged last session is re-sent when the link opens.
    for (const list of Object.values(grouped)) {
      for (const m of list) if (m.dir === 'out' && m.status === 'sent') m.status = 'queued';
    }
    this.messages = grouped;
    this.peers = peers;
    this.ready = true;

    this.connectHub();
    this.tickTimer = setInterval(() => this.tick(), 5000);
    window.addEventListener('online', this.onNetwork);
    document.addEventListener('visibilitychange', this.onNetwork);
  }

  stop() {
    if (typeof window === 'undefined') return; // server render: nothing was started
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    clearInterval(this.tickTimer);
    clearTimeout(this.noticeTimer);
    window.removeEventListener('online', this.onNetwork);
    document.removeEventListener('visibilitychange', this.onNetwork);
    for (const key of [...this.links.keys()]) this.dropLink(key);
    this.ws?.close();
    this.ws = null;
  }

  private onNetwork = () => {
    if (document.visibilityState === 'hidden') return;
    if (!this.ws || this.ws.readyState > 1) {
      clearTimeout(this.reconnectTimer);
      this.backoff = 1000;
      this.connectHub();
    }
  };

  say(text: string) {
    this.notice = text;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => (this.notice = ''), 4000);
  }

  // ---- Hub (presence + signaling) ----

  private connectHub() {
    if (this.stopped || this.hub === 'replaced') return;
    this.hub = 'connecting';
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${signalingBase()}/ws/hub/${this.myKey}`);
    } catch {
      this.hub = 'offline';
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    socket.onopen = () => {
      this.hub = 'online';
      this.backoff = 1000;
      this.sendWatch();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (socket.readyState === 1) socket.send('ping');
      }, 25_000);
    };
    socket.onmessage = (e) => this.onHubMessage(e.data);
    socket.onclose = (e) => {
      if (this.ws !== socket) return;
      clearInterval(this.pingTimer);
      this.online = {};
      if (e.code === 4000) {
        this.hub = 'replaced';
        return;
      }
      this.hub = 'offline';
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connectHub(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 15_000);
  }

  /** Take the connection back after another tab replaced it. */
  reclaim() {
    this.hub = 'connecting';
    this.backoff = 1000;
    this.connectHub();
  }

  private sendHub(payload: Record<string, unknown>) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(payload));
  }

  private sendWatch() {
    this.sendHub({ type: 'watch', keys: this.peers.filter((p) => p.accepted).map((p) => p.key) });
  }

  private signal(to: string, payload: Record<string, unknown>) {
    this.sendHub({ type: 'signal', to, payload });
  }

  private onHubMessage(data: unknown) {
    if (typeof data !== 'string' || data === 'pong') return;
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === 'presence') {
      if (Array.isArray(msg.online)) {
        const next: Record<string, boolean> = {};
        for (const p of this.peers) next[p.key] = msg.online.includes(p.key);
        this.online = next;
        for (const key of msg.online as string[]) this.maybeConnect(key);
      } else if (typeof msg.key === 'string') {
        this.online[msg.key] = !!msg.online;
        if (msg.online) {
          this.declinedBy[msg.key] = false;
          this.maybeConnect(msg.key);
        }
      }
    } else if (msg.type === 'offline' && typeof msg.key === 'string') {
      this.online[msg.key] = false;
    } else if (msg.type === 'signal' && typeof msg.from === 'string') {
      void this.onSignal(msg.from, msg.payload ?? {});
    } else if (msg.type === 'replaced') {
      this.hub = 'replaced';
    }
  }

  // ---- Contacts ----

  addPeer(key: string, tok?: string): Peer {
    let peer = this.peers.find((p) => p.key === key);
    if (peer) {
      peer.accepted = true;
      peer.declined = false;
      if (tok) peer.tok = tok;
    } else {
      this.peers.push({ key, accepted: true, tok, addedAt: Date.now(), lastTs: Date.now(), unread: 0 });
      peer = this.peers.find((p) => p.key === key)!;
    }
    void putPeer(peer);
    this.sendWatch();
    this.declinedBy[key] = false;
    const stashed = this.stash.get(key);
    if (stashed) void this.replayStash(key);
    else this.maybeConnect(key);
    return peer;
  }

  rename(key: string, nickname: string) {
    const peer = this.peers.find((p) => p.key === key);
    if (!peer) return;
    peer.nickname = nickname.trim() || undefined;
    void putPeer(peer);
  }

  setMyName(name: string) {
    this.myName = name.trim() || guessDeviceName();
    lsSet('nabl-notepad-name', this.myName);
    for (const l of this.links.values()) this.sendDc(l, { t: 'hello', name: this.myName });
  }

  /** Invalidate the old share link/QR (anyone holding it must ask to connect again). */
  resetToken() {
    this.myToken = randomString(8);
    lsSet('nabl-notepad-token', this.myToken);
  }

  removePeer(key: string) {
    this.dropLink(key);
    this.peers = this.peers.filter((p) => p.key !== key);
    delete this.messages[key];
    this.stash.delete(key);
    if (this.active === key) this.active = null;
    void delPeer(key);
    this.sendWatch();
  }

  clearChat(key: string) {
    this.messages[key] = [];
    void delMsgsFor(key);
    const peer = this.peers.find((p) => p.key === key);
    if (peer) {
      peer.lastTs = peer.addedAt;
      void putPeer(peer);
    }
  }

  accept(key: string) {
    this.addPeer(key);
    this.active = key;
  }

  decline(key: string) {
    const peer = this.peers.find((p) => p.key === key);
    if (!peer) return;
    peer.declined = true;
    void putPeer(peer);
    this.stash.delete(key);
    this.dropLink(key);
    this.signal(key, { kind: 'declined' });
  }

  openChat(key: string | null) {
    this.active = key;
    if (!key) return;
    const peer = this.peers.find((p) => p.key === key);
    if (peer && peer.unread) {
      peer.unread = 0;
      void putPeer(peer);
    }
  }

  // ---- Sending ----

  sendText(key: string, text: string) {
    const clean = text.replace(/\s+$/, '');
    if (!clean) return;
    this.enqueue({ id: crypto.randomUUID(), peer: key, ts: Date.now(), dir: 'out', kind: 'text', text: clean, status: 'queued' });
  }

  async sendImages(key: string, files: File[]) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        this.say(`“${file.name}” isn’t an image — only text and images can be sent here.`);
        continue;
      }
      const prepared = await prepareImage(file);
      if (prepared.blob.size > MAX_IMAGE_BYTES) {
        this.say(`“${file.name}” is too large (limit 25 MB).`);
        continue;
      }
      this.enqueue({
        id: crypto.randomUUID(),
        peer: key,
        ts: Date.now(),
        dir: 'out',
        kind: 'image',
        blob: prepared.blob,
        mime: prepared.mime,
        name: prepared.name,
        status: 'queued',
      });
    }
  }

  private enqueue(m: Msg) {
    this.pushMessage(m);
    void this.flush(m.peer);
  }

  private pushMessage(m: Msg) {
    if (!this.messages[m.peer]) this.messages[m.peer] = [];
    this.messages[m.peer].push(m);
    void putMsg(m);
    const peer = this.peers.find((p) => p.key === m.peer);
    if (peer) {
      peer.lastTs = m.ts;
      void putPeer(peer);
    }
  }

  private waitLow(dc: RTCDataChannel): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        dc.removeEventListener('bufferedamountlow', done);
        dc.removeEventListener('close', done);
        resolve();
      };
      dc.addEventListener('bufferedamountlow', done);
      dc.addEventListener('close', done);
    });
  }

  private sendDc(l: Link, payload: Record<string, unknown>) {
    if (l.dc.readyState === 'open') l.dc.send(JSON.stringify(payload));
  }

  private async transmit(l: Link, m: Msg) {
    if (m.kind === 'text') {
      this.sendDc(l, { t: 'text', id: m.id, ts: m.ts, text: m.text });
      return;
    }
    const blob = m.blob!;
    this.sendDc(l, { t: 'img', id: m.id, ts: m.ts, mime: m.mime, name: m.name, size: blob.size });
    const buffer = await blob.arrayBuffer();
    for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
      if (l.dc.readyState !== 'open') throw new Error('closed');
      if (l.dc.bufferedAmount > BUFFER_HIGH) await this.waitLow(l.dc);
      l.dc.send(buffer.slice(offset, offset + CHUNK_SIZE));
    }
    this.sendDc(l, { t: 'img-end', id: m.id });
  }

  private async flush(key: string) {
    const l = this.links.get(key);
    if (!l || l.dc.readyState !== 'open' || l.flushing) return;
    l.flushing = true;
    try {
      for (;;) {
        const next = (this.messages[key] ?? []).find((m) => m.dir === 'out' && m.status === 'queued');
        if (!next) break;
        // Mark first so a message added mid-flush is picked up by the next loop pass.
        next.status = 'sent';
        await this.transmit(l, next);
        void putMsg(next);
      }
    } catch {
      // link dropped mid-send — unacked messages go back to 'queued' on reconnect
      for (const m of this.messages[key] ?? []) if (m.dir === 'out' && m.status === 'sent') m.status = 'queued';
    } finally {
      l.flushing = false;
    }
  }

  // ---- Receiving ----

  private onDcMessage(key: string, l: Link, data: unknown) {
    if (typeof data !== 'string') {
      if (l.recv) l.recv.chunks.push(data as ArrayBuffer);
      return;
    }
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    switch (msg.t) {
      case 'hello': {
        const peer = this.peers.find((p) => p.key === key);
        if (peer && typeof msg.name === 'string') {
          peer.theirName = msg.name.slice(0, 40);
          void putPeer(peer);
        }
        break;
      }
      case 'text':
        if (typeof msg.id === 'string' && typeof msg.text === 'string') {
          this.receive(key, l, { id: msg.id, kind: 'text', text: msg.text.slice(0, 50_000) });
        }
        break;
      case 'img':
        l.recv = {
          meta: { id: String(msg.id), ts: Date.now(), mime: String(msg.mime || 'image/png'), name: String(msg.name || 'image') },
          chunks: [],
        };
        break;
      case 'img-end':
        if (l.recv && l.recv.meta.id === msg.id) {
          const { meta, chunks } = l.recv;
          l.recv = null;
          const mime = /^image\/[a-z0-9.+-]+$/i.test(meta.mime) ? meta.mime : 'application/octet-stream';
          this.receive(key, l, { id: meta.id, kind: 'image', blob: new Blob(chunks, { type: mime }), mime, name: meta.name });
        }
        break;
      case 'ack': {
        const m = (this.messages[key] ?? []).find((x) => x.id === msg.id);
        if (m && m.dir === 'out' && m.status !== 'delivered') {
          m.status = 'delivered';
          void putMsg(m);
        }
        break;
      }
    }
  }

  private receive(key: string, l: Link, part: { id: string; kind: 'text' | 'image'; text?: string; blob?: Blob; mime?: string; name?: string }) {
    this.sendDc(l, { t: 'ack', id: part.id });
    if ((this.messages[key] ?? []).some((m) => m.id === part.id)) return; // resend of something we already have
    this.pushMessage({ ...part, peer: key, ts: Date.now(), dir: 'in', status: 'received' });
    const peer = this.peers.find((p) => p.key === key);
    if (peer && (this.active !== key || document.visibilityState === 'hidden')) {
      peer.unread += 1;
      void putPeer(peer);
    }
  }

  // ---- WebRTC links (one per chat) ----

  private polite(key: string) {
    return this.myKey > key;
  }

  private maybeConnect(key: string) {
    const peer = this.peers.find((p) => p.key === key);
    if (!peer || !peer.accepted || this.stopped) return;
    if (this.links.has(key) || !this.online[key] || this.declinedBy[key] || this.hub !== 'online') return;
    void this.startOffer(key);
  }

  private tick() {
    for (const [key, l] of this.links) {
      if (l.dc.readyState !== 'open' && Date.now() - l.startedAt > STALE_LINK_MS) this.dropLink(key);
    }
    for (const p of this.peers) if (p.accepted) this.maybeConnect(p.key);
  }

  private makeLink(key: string): Link {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // Same pre-agreed channel on both sides, so there is never a duplicate to reconcile.
    const dc = pc.createDataChannel('chat', { negotiated: true, id: 0 });
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = BUFFER_LOW;
    const l: Link = { pc, dc, making: false, ignoreOffer: false, pendingIce: [], startedAt: Date.now(), flushing: false, recv: null };
    this.links.set(key, l);
    this.link[key] = 'connecting';

    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(key, { kind: 'ice', candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.dropLink(key, pc);
    };
    dc.onopen = () => {
      this.link[key] = 'connected';
      this.online[key] = true;
      for (const m of this.messages[key] ?? []) if (m.dir === 'out' && m.status === 'sent') m.status = 'queued';
      this.sendDc(l, { t: 'hello', name: this.myName });
      void this.flush(key);
    };
    dc.onclose = () => this.dropLink(key, pc);
    dc.onmessage = (e) => this.onDcMessage(key, l, e.data);
    return l;
  }

  private dropLink(key: string, onlyIfPc?: RTCPeerConnection) {
    const l = this.links.get(key);
    if (!l || (onlyIfPc && l.pc !== onlyIfPc)) return;
    this.links.delete(key);
    this.link[key] = 'idle';
    l.dc.onclose = null;
    l.pc.onconnectionstatechange = null;
    try {
      l.dc.close();
      l.pc.close();
    } catch {
      // already closed
    }
    for (const m of this.messages[key] ?? []) if (m.dir === 'out' && m.status === 'sent') m.status = 'queued';
  }

  private async startOffer(key: string) {
    const l = this.makeLink(key);
    try {
      l.making = true;
      const offer = await l.pc.createOffer();
      await l.pc.setLocalDescription(offer);
      this.signal(key, this.sdpPayload(key, l.pc.localDescription!));
    } catch {
      this.dropLink(key, l.pc);
    } finally {
      l.making = false;
    }
  }

  private sdpPayload(key: string, desc: RTCSessionDescription | RTCSessionDescriptionInit) {
    const peer = this.peers.find((p) => p.key === key);
    return { kind: 'sdp', description: { type: desc.type, sdp: desc.sdp }, name: this.myName, tok: peer?.tok };
  }

  private async onSignal(from: string, payload: Record<string, any>) {
    if (!KEY_RE.test(from) || from === this.myKey) return;

    if (payload.kind === 'declined') {
      this.declinedBy[from] = true;
      this.dropLink(from);
      return;
    }
    if (payload.kind !== 'sdp' && payload.kind !== 'ice') return;

    let peer = this.peers.find((p) => p.key === from);
    if (peer?.declined) return;

    if (!peer || !peer.accepted) {
      // Unknown device: hold its negotiation until I accept (or its link token matches mine).
      if (!this.stash.has(from) && this.stash.size >= 50) return; // don't let strangers grow memory without bound
      const st = this.stash.get(from) ?? { offer: null, ice: [] };
      if (payload.kind === 'sdp') {
        if (payload.description?.type !== 'offer') return;
        st.offer = payload;
        st.ice = [];
      } else if (st.ice.length < 60) {
        st.ice.push(payload.candidate);
      }
      this.stash.set(from, st);
      if (!peer && payload.kind === 'sdp') {
        this.peers.push({
          key: from,
          theirName: typeof payload.name === 'string' ? payload.name.slice(0, 40) : undefined,
          accepted: false,
          addedAt: Date.now(),
          lastTs: Date.now(),
          unread: 0,
        });
        peer = this.peers.find((p) => p.key === from)!;
        void putPeer(peer);
      }
      if (payload.kind === 'sdp' && payload.tok && payload.tok === this.myToken) this.addPeer(from);
      return;
    }

    await this.handleSignal(from, payload);
  }

  private async replayStash(key: string) {
    const st = this.stash.get(key);
    this.stash.delete(key);
    if (!st?.offer) {
      this.maybeConnect(key);
      return;
    }
    await this.handleSignal(key, st.offer);
    for (const c of st.ice) await this.handleSignal(key, { kind: 'ice', candidate: c });
  }

  private async handleSignal(key: string, payload: Record<string, any>) {
    const l = this.links.get(key) ?? this.makeLink(key);
    try {
      if (payload.kind === 'sdp') {
        const desc = payload.description as RTCSessionDescriptionInit;
        const collision = desc.type === 'offer' && (l.making || l.pc.signalingState !== 'stable');
        l.ignoreOffer = !this.polite(key) && collision;
        if (l.ignoreOffer) return;
        await l.pc.setRemoteDescription(desc);
        for (const c of l.pendingIce.splice(0)) await l.pc.addIceCandidate(c).catch(() => {});
        if (desc.type === 'offer') {
          const answer = await l.pc.createAnswer();
          await l.pc.setLocalDescription(answer);
          this.signal(key, this.sdpPayload(key, l.pc.localDescription!));
        }
        const peer = this.peers.find((p) => p.key === key);
        if (peer && typeof payload.name === 'string' && !peer.theirName) {
          peer.theirName = payload.name.slice(0, 40);
          void putPeer(peer);
        }
      } else if (payload.kind === 'ice' && payload.candidate) {
        if (l.pc.remoteDescription) {
          await l.pc.addIceCandidate(payload.candidate).catch((err) => {
            if (!l.ignoreOffer) throw err;
          });
        } else {
          l.pendingIce.push(payload.candidate);
        }
      }
    } catch {
      this.dropLink(key, l.pc);
    }
  }
}

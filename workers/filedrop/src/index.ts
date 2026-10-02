// @ts-nocheck
//
// This file is a standalone Cloudflare Worker project (its own
// package.json/tsconfig.json in this directory, deployed separately from
// the Astro site — see README.md) that relies on ambient Workers runtime
// types from `@cloudflare/workers-types` (WebSocketPair, DurableObject,
// DurableObjectNamespace, the `webSocket` ResponseInit field, etc). Those
// types are only resolvable once `npm install` has been run *inside
// workers/filedrop*, which this session intentionally does not do (see
// the repo-root task constraints). The root project's `astro check` also
// walks this file (its tsconfig has no `exclude` for workers/), where
// those types aren't installed either. `@ts-nocheck` keeps this file from
// breaking the root site's typecheck/build without editing the root
// tsconfig.json, which is out of scope for this tool. Once
// `workers/filedrop`'s own dependencies are installed, remove this
// pragma and run `npm run typecheck` from *inside* workers/filedrop to
// verify the file against the real Workers types.

/**
 * File Drop signaling server.
 *
 * This Worker never sees file bytes. It does exactly one job: relay small
 * JSON WebRTC signaling messages (SDP offers/answers, ICE candidates)
 * between the two browser tabs that make up one File Drop pairing, so they
 * can negotiate a direct RTCPeerConnection. Once that connection is up, all
 * file data flows peer-to-peer and this Worker is no longer involved.
 *
 * Routing: `GET /ws/filedrop/<code>` (WebSocket upgrade) is routed by
 * session code to one Durable Object instance (`FileDropSession`), which
 * holds up to two sockets for that code and relays messages between them.
 */

export interface Env {
  SESSION_DO: DurableObjectNamespace;
}

// File Drop and Shared Notepad both just need a two-peer signaling relay.
const SESSION_PATH = /^\/ws\/(?:filedrop|notepad)\/([A-Za-z0-9]{4,12})$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(SESSION_PATH);

    if (!match) {
      return new Response('Not found. Expected /ws/filedrop/<session-code>.', { status: 404 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade request.', { status: 426 });
    }

    const sessionCode = match[1].toUpperCase();
    // Namespace by tool so a File Drop code and a Notepad code never collide.
    const tool = url.pathname.split('/')[2];
    const id = env.SESSION_DO.idFromName(`${tool}:${sessionCode}`);
    const stub = env.SESSION_DO.get(id);
    return stub.fetch(request);
  },
};

/** Signaling-only cap: real file data never flows through this channel. */
const MAX_SIGNAL_MESSAGE_BYTES = 16 * 1024;
const MAX_SOCKETS_PER_SESSION = 2;

export class FileDropSession implements DurableObject {
  private sockets = new Set<WebSocket>();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade request.', { status: 426 });
    }

    if (this.sockets.size >= MAX_SOCKETS_PER_SESSION) {
      return new Response('This File Drop session already has two devices connected.', { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.handleSession(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  private handleSession(ws: WebSocket) {
    ws.accept();

    const isFirst = this.sockets.size === 0;
    this.sockets.add(ws);

    this.sendJson(ws, { type: isFirst ? 'session-created' : 'session-joined', role: isFirst ? 'host' : 'joiner' });
    if (!isFirst) {
      this.broadcastExcept(ws, { type: 'peer-joined' });
    }

    ws.addEventListener('message', (event) => this.relay(ws, event.data));

    ws.addEventListener('close', () => this.drop(ws));
    ws.addEventListener('error', () => this.drop(ws));
  }

  private relay(sender: WebSocket, data: string | ArrayBuffer) {
    const size = typeof data === 'string' ? data.length : data.byteLength;
    if (size > MAX_SIGNAL_MESSAGE_BYTES) {
      // Structurally reject anything that looks like file data — this
      // channel is signaling-only by design, never a file relay.
      this.sendJson(sender, { type: 'error', message: 'Message too large for the signaling channel.' });
      return;
    }

    for (const socket of this.sockets) {
      if (socket === sender) continue;
      try {
        socket.send(data);
      } catch {
        // Peer socket not writable (closing/closed) — drop silently, its
        // own close/error listener will clean it up.
      }
    }
  }

  private drop(ws: WebSocket) {
    if (!this.sockets.delete(ws)) return;
    this.broadcastExcept(ws, { type: 'peer-left' });
  }

  private broadcastExcept(exclude: WebSocket, payload: unknown) {
    for (const socket of this.sockets) {
      if (socket !== exclude) this.sendJson(socket, payload);
    }
  }

  private sendJson(ws: WebSocket, payload: unknown) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Socket already closing — ignore.
    }
  }
}

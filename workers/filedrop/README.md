# File Drop signaling server

A minimal Cloudflare Worker + Durable Object that lets two File Drop browser
tabs find each other and negotiate a direct WebRTC connection. It relays
small JSON signaling messages (SDP offers/answers, ICE candidates) between
exactly two WebSocket connections per session code, and rejects anything
larger than 16KB or a third connection to an already-full session. **File
bytes never pass through this Worker** — once the two browsers have a
`RTCDataChannel` open, this server is out of the loop entirely.

This is deployed **separately** from the main Astro static site (`npm run
build` at the repo root does not touch this directory). It has its own
`package.json` and is not a dependency of the root project.

## Deploy steps (a human needs to do this)

1. **Install dependencies** (only inside this directory — do not run this
   at the repo root):
   ```sh
   cd workers/filedrop
   npm install
   ```

2. **Authenticate wrangler** with the Cloudflare account that will host
   this Worker:
   ```sh
   npx wrangler login
   ```

3. **(Optional) set a real route.** `wrangler.toml` ships with a commented-
   out `routes` block pointing at a placeholder domain
   (`signal.tools.nabl.in`). Either:
   - uncomment and edit it to the real subdomain once DNS for it is
     proxied through Cloudflare, or
   - leave it commented and use the Worker's default
     `nabl-filedrop-signaling.<your-subdomain>.workers.dev` URL.

4. **Deploy:**
   ```sh
   npx wrangler deploy
   ```
   This also runs the Durable Object migration declared in
   `wrangler.toml` (`FileDropSession`) on first deploy. Durable Objects
   currently require the Workers Paid plan (or the newer SQLite-backed DO
   class on some accounts) — check the Cloudflare dashboard if `deploy`
   errors on the migration.

5. **Point the site at it.** The Astro site reads the signaling server's
   base WebSocket URL from the `PUBLIC_SIGNALING_URL` build-time
   environment variable (see `src/tools/file-drop/FileDrop.svelte`). Set it
   to the deployed Worker's base URL using the `wss://` scheme, **without**
   a trailing session code — the client appends `/<code>` itself:
   ```sh
   # from the repo root
   PUBLIC_SIGNALING_URL="wss://signal.tools.nabl.in/ws/filedrop" npm run build
   ```
   or, on the default workers.dev host:
   ```sh
   PUBLIC_SIGNALING_URL="wss://nabl-filedrop-signaling.<your-subdomain>.workers.dev/ws/filedrop" npm run build
   ```
   Without this env var set at build time, the client falls back to a
   same-origin `wss://<site-host>/ws/filedrop/<code>` path, which will only
   work if you separately proxy that path to the Worker (e.g. via a
   Cloudflare Worker route or a reverse proxy in front of the static site).
   For a first deploy, setting `PUBLIC_SIGNALING_URL` explicitly is the
   simplest path.

6. **Smoke-test:** open `/file-drop` in two browser tabs (or two devices),
   confirm the QR/code pairs them, and that the connection LED goes from
   "Waiting for peer" to "Connected". This was **not** verified in the
   sandbox this Worker was written in — there was no live Cloudflare
   account or deployed Worker to connect to, so only the code paths (not
   an actual two-device transfer) were exercised.

## Not implemented (possible follow-ups)

- **TURN relay.** Only a public STUN server
  (`stun:stun.l.google.com:19302`) is configured client-side. Two devices
  behind symmetric NATs or a restrictive corporate/public network may fail
  to establish a direct connection and will need a TURN server to fall
  back to (still never touching file bytes in plaintext there either, but
  it is a real relay of encrypted media). This is explicitly called out to
  users in the tool's FAQ/tips copy already in
  `src/content/tools/file-drop.md`.
- **WebSocket Hibernation API.** The Durable Object currently keeps
  sockets in an in-memory `Set` and stays billed as "active" for the
  lifetime of a pairing session. Since sessions are short-lived (a single
  pairing + transfer), this is fine for v1, but migrating to Cloudflare's
  Hibernatable WebSockets API would reduce duration charges if usage grows.
- **Session expiry.** A session code lives as long as its Durable Object
  instance is warm; there's no explicit TTL/cleanup. In practice an idle
  DO with no attached sockets costs nothing meaningful, but a scheduled
  alarm to force-close abandoned sessions would be a tidy addition.

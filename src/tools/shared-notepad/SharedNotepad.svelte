<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import QRCode from 'qrcode';
  import Led from '../../design/primitives/Led.svelte';
  import { NotepadEngine, formatKey, parseKeyInput, type Msg, type Peer } from './engine.svelte';

  const supported =
    typeof window !== 'undefined' &&
    !!window.RTCPeerConnection &&
    !!window.WebSocket &&
    !!window.crypto?.getRandomValues;

  const engine = new NotepadEngine();

  let root: HTMLDivElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();
  let composer: HTMLTextAreaElement | undefined = $state();
  let qrCanvas: HTMLCanvasElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();

  let addInput = $state('');
  let addError = $state('');
  let showQr = $state(false);
  let qrTouched = false;
  let draft = $state('');
  let fullscreen = $state(false);
  let nativeFullscreen = false;
  let dragging = $state(false);
  let editingName = $state(false);
  let nameDraft = $state('');
  let editingPeer = $state(false);
  let peerDraft = $state('');
  let menuOpen = $state(false);
  let copied = $state('');
  let coarsePointer = false;
  let lightbox = $state<{ url: string; name: string; blob: Blob } | null>(null);
  let origin = $state('');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  const urls = new Map<string, string>();
  let baseTitle = '';

  const chats = $derived(engine.peers.filter((p) => p.accepted).slice().sort((a, b) => b.lastTs - a.lastTs));
  const activePeer = $derived(engine.peers.find((p) => p.key === engine.active && p.accepted) ?? null);
  const thread = $derived<Msg[]>(activePeer ? (engine.messages[activePeer.key] ?? []) : []);
  const totalUnread = $derived(engine.peers.reduce((n, p) => n + (p.accepted ? p.unread : 0), 0));
  const shareLink = $derived(
    engine.myKey && origin ? `${origin}?add=${engine.myKey}&t=${engine.myToken}` : '',
  );

  const ledState = $derived.by((): 'off' | 'ready' | 'live' | 'error' => {
    if (engine.hub === 'online') return 'live';
    if (engine.hub === 'connecting') return 'ready';
    return 'error';
  });
  const ledLabel = $derived(
    engine.hub === 'online'
      ? 'Ready'
      : engine.hub === 'connecting'
        ? 'Connecting'
        : engine.hub === 'replaced'
          ? 'Open elsewhere'
          : 'Offline — retrying',
  );

  function statusOf(p: Peer): string {
    if (engine.declinedBy[p.key]) return 'Request not accepted';
    if (engine.link[p.key] === 'connected') return 'Connected';
    if (engine.online[p.key]) return 'Online — connecting…';
    return 'Offline';
  }

  function dotOf(p: Peer): 'live' | 'ready' | 'off' {
    if (engine.link[p.key] === 'connected') return 'live';
    if (engine.online[p.key] && !engine.declinedBy[p.key]) return 'ready';
    return 'off';
  }

  function preview(p: Peer): string {
    const list = engine.messages[p.key] ?? [];
    const last = list[list.length - 1];
    if (!last) return statusOf(p);
    const who = last.dir === 'out' ? 'You: ' : '';
    return who + (last.kind === 'image' ? 'Photo' : (last.text ?? '').replace(/\s+/g, ' '));
  }

  function clock(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function dayLabel(ts: number): string {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function newDay(i: number): boolean {
    return i === 0 || new Date(thread[i - 1].ts).toDateString() !== new Date(thread[i].ts).toDateString();
  }

  function urlFor(m: Msg): string {
    let url = urls.get(m.id);
    if (!url && m.blob) {
      url = URL.createObjectURL(m.blob);
      urls.set(m.id, url);
    }
    return url ?? '';
  }

  async function copy(text: string, tag: string) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
    }
    if (ok) {
      copied = tag;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = ''), 1400);
    } else {
      engine.say('Copy blocked by the browser — select the text and copy it manually.');
    }
  }

  async function shareLinkNow() {
    if (!shareLink) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Chat with my device on NABL Tools', url: shareLink });
        return;
      } catch {
        // dismissed or unsupported payload — fall back to copying
      }
    }
    await copy(shareLink, 'link');
  }

  async function copyImage(blob: Blob) {
    try {
      let out = blob;
      if (blob.type !== 'image/png') {
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        out = (await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))) ?? blob;
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': out })]);
      copied = 'image';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = ''), 1400);
    } catch {
      engine.say('Could not copy the image — use Save instead.');
    }
  }

  // ---- Adding a device ----

  function submitAdd(e: Event) {
    e.preventDefault();
    const parsed = parseKeyInput(addInput);
    if (!parsed) {
      addError = 'That doesn’t look right. A key is 8 letters/numbers, like K7F2-9QWX.';
      return;
    }
    if (parsed.key === engine.myKey) {
      addError = 'That’s this device’s own key — enter the key from your other device.';
      return;
    }
    addError = '';
    engine.addPeer(parsed.key, parsed.tok);
    engine.openChat(parsed.key);
    addInput = '';
    composer?.focus();
  }

  // ---- Chat actions ----

  function send() {
    if (!activePeer) return;
    const text = draft;
    if (!text.trim()) return;
    engine.sendText(activePeer.key, text);
    draft = '';
    if (composer) composer.style.height = 'auto';
    composer?.focus();
  }

  function onComposerKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !coarsePointer) {
      e.preventDefault();
      send();
    }
  }

  function autosize() {
    if (!composer) return;
    composer.style.height = 'auto';
    composer.style.height = `${Math.min(composer.scrollHeight, 160)}px`;
  }

  function pickFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (activePeer && input.files?.length) void engine.sendImages(activePeer.key, [...input.files]);
    input.value = '';
  }

  function onPaste(e: ClipboardEvent) {
    if (!activePeer) return;
    const files = [...(e.clipboardData?.items ?? [])]
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();
      void engine.sendImages(activePeer.key, files);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (activePeer && e.dataTransfer?.files.length) void engine.sendImages(activePeer.key, [...e.dataTransfer.files]);
  }

  function onDragOver(e: DragEvent) {
    if (!activePeer || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragging = true;
  }

  function beginRenamePeer() {
    if (!activePeer) return;
    peerDraft = activePeer.nickname ?? '';
    editingPeer = true;
    menuOpen = false;
  }

  function commitRenamePeer() {
    if (activePeer && editingPeer) engine.rename(activePeer.key, peerDraft);
    editingPeer = false;
  }

  function commitName() {
    if (editingName) engine.setMyName(nameDraft);
    editingName = false;
  }

  function clearChat() {
    menuOpen = false;
    if (activePeer && confirm('Delete every message in this chat from this device? The other device keeps its copy.')) {
      engine.clearChat(activePeer.key);
    }
  }

  function removeChat() {
    menuOpen = false;
    if (activePeer && confirm('Remove this chat and its messages from this device?')) engine.removePeer(activePeer.key);
  }

  // ---- Full screen ----

  async function toggleFullscreen() {
    if (!fullscreen) {
      fullscreen = true;
      try {
        await root?.requestFullscreen?.();
        nativeFullscreen = !!document.fullscreenElement;
      } catch {
        nativeFullscreen = false; // e.g. iOS Safari — the in-page overlay still fills the screen
      }
    } else {
      fullscreen = false;
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      nativeFullscreen = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (lightbox) lightbox = null;
    else if (menuOpen) menuOpen = false;
    else if (fullscreen && !nativeFullscreen) void toggleFullscreen();
  }

  function onFullscreenChange() {
    if (!document.fullscreenElement && nativeFullscreen) {
      fullscreen = false;
      nativeFullscreen = false;
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible' && engine.active) engine.openChat(engine.active);
  }

  // ---- Effects ----

  $effect(() => {
    if (!qrCanvas || !showQr || !shareLink) return;
    QRCode.toCanvas(qrCanvas, shareLink, {
      width: 192,
      margin: 1,
      color: { dark: '#141413', light: '#ffffff' },
    }).catch(() => engine.say('Could not draw the QR code — use the key or link instead.'));
  });

  // Open the QR panel for first-time users (nobody to chat with yet) until they choose otherwise.
  $effect(() => {
    if (engine.ready && !qrTouched) showQr = engine.peers.filter((p) => p.accepted).length === 0;
  });

  $effect(() => {
    void thread.length;
    void engine.active;
    void tick().then(() => {
      if (listEl) listEl.scrollTop = listEl.scrollHeight;
    });
  });

  $effect(() => {
    if (engine.active && document.visibilityState === 'visible') engine.openChat(engine.active);
  });

  $effect(() => {
    if (!baseTitle) return;
    document.title = totalUnread > 0 ? `(${totalUnread}) ${baseTitle}` : baseTitle;
  });

  $effect(() => {
    document.documentElement.style.overflow = fullscreen ? 'hidden' : '';
  });

  onMount(async () => {
    if (!supported) return;
    origin = `${window.location.origin}${window.location.pathname}`;
    baseTitle = document.title;
    coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', onVisibility);

    await engine.start();

    // Share link / QR: ?add=KEY&t=TOKEN adds that device and opens the chat.
    const params = new URLSearchParams(window.location.search);
    if (params.has('add')) {
      const parsed = parseKeyInput(`?add=${params.get('add')}&t=${params.get('t') ?? ''}`);
      if (parsed && parsed.key !== engine.myKey) {
        engine.addPeer(parsed.key, parsed.tok);
        engine.openChat(parsed.key);
      } else if (parsed) {
        engine.say('That link is for this very device — open it on your other device.');
      }
      history.replaceState(null, '', window.location.pathname);
    }
  });

  onDestroy(() => {
    clearTimeout(copyTimer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('visibilitychange', onVisibility);
      document.documentElement.style.overflow = '';
      if (baseTitle) document.title = baseTitle;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    }
    for (const url of urls.values()) URL.revokeObjectURL(url);
    engine.stop();
  });
</script>

{#if !supported}
  <p class="notice">
    Your browser doesn't support the WebRTC and WebSocket APIs Shared Notepad needs. Try a recent version of Chrome,
    Firefox, Safari, or Edge.
  </p>
{:else}
  <div class="app" class:fullscreen class:chat-open={!!activePeer} bind:this={root}>
    <!-- ================= Sidebar ================= -->
    <aside class="side" aria-label="Your devices and chats">
      <div class="side-head">
        <h2 class="side-title">Chats</h2>
        <Led state={ledState} label={ledLabel} />
      </div>

      {#if engine.hub === 'replaced'}
        <div class="banner" role="alert">
          <span>Shared Notepad is open in another tab, which took over this device’s key.</span>
          <button type="button" class="btn small" onclick={() => engine.reclaim()}>Use it here</button>
        </div>
      {/if}

      <div class="me">
        <div class="me-row">
          <span class="label">This device</span>
          {#if editingName}
            <input
              class="inline-input"
              aria-label="Device name"
              maxlength="40"
              bind:value={nameDraft}
              onblur={commitName}
              onkeydown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') editingName = false;
              }}
            />
          {:else}
            <button
              type="button"
              class="link-btn"
              title="Rename this device"
              onclick={() => {
                nameDraft = engine.myName;
                editingName = true;
              }}>{engine.myName || 'This device'} <span class="edit-hint">edit</span></button
            >
          {/if}
        </div>
        <p class="label key-label">Your key — permanent, share it with your other devices</p>
        <p class="mykey readout" aria-label={`Your key is ${engine.myKey.split('').join(' ')}`}>
          {engine.myKey ? formatKey(engine.myKey) : '········'}
        </p>
        <div class="btn-row">
          <button type="button" class="btn" onclick={() => copy(engine.myKey, 'key')} disabled={!engine.myKey}>
            {copied === 'key' ? 'Copied' : 'Copy key'}
          </button>
          <button type="button" class="btn" onclick={shareLinkNow} disabled={!shareLink}>
            {copied === 'link' ? 'Link copied' : 'Share link'}
          </button>
          <button
            type="button"
            class="btn"
            aria-expanded={showQr}
            onclick={() => {
              qrTouched = true;
              showQr = !showQr;
            }}>{showQr ? 'Hide QR' : 'Show QR'}</button
          >
        </div>
        {#if showQr}
          <div class="qr">
            <div class="qr-wrap"><canvas bind:this={qrCanvas} width="192" height="192"></canvas></div>
            <p class="hint">
              Scan this with your other device’s camera. It opens this page and connects straight away — no typing.
            </p>
            <button
              type="button"
              class="link-btn danger"
              onclick={() => {
                if (confirm('Reset your link and QR? Old links will no longer connect without your approval. Your key stays the same.')) {
                  engine.resetToken();
                }
              }}>Reset link &amp; QR</button
            >
          </div>
        {/if}
      </div>

      <form class="add" onsubmit={submitAdd}>
        <label class="label" for="add-key">Add a device</label>
        <div class="add-row">
          <input
            id="add-key"
            type="text"
            inputmode="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            placeholder="Enter its key, e.g. K7F2-9QWX"
            bind:value={addInput}
            oninput={() => (addError = '')}
          />
          <button type="submit" class="btn primary" disabled={!addInput.trim()}>Add</button>
        </div>
        {#if addError}<p class="field-error" role="alert">{addError}</p>{/if}
      </form>

      {#if engine.requests.length}
        <div class="group">
          <p class="label">Wants to chat</p>
          {#each engine.requests as r (r.key)}
            <div class="request">
              <div class="request-name">
                <strong>{engine.displayName(r)}</strong>
                <span class="readout">{formatKey(r.key)}</span>
              </div>
              <div class="btn-row">
                <button type="button" class="btn primary small" onclick={() => engine.accept(r.key)}>Accept</button>
                <button type="button" class="btn small" onclick={() => engine.decline(r.key)}>Decline</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <ul class="chat-list" aria-label="Chats">
        {#each chats as p (p.key)}
          <li>
            <button
              type="button"
              class="chat-item"
              class:selected={engine.active === p.key}
              onclick={() => engine.openChat(p.key)}
            >
              <span class="dot dot-{dotOf(p)}" aria-hidden="true"></span>
              <span class="chat-main">
                <span class="chat-name">{engine.displayName(p)} <span class="short-key">· {p.key.slice(0, 4)}</span></span>
                <span class="chat-preview">{preview(p)}</span>
              </span>
              {#if p.unread}<span class="badge" aria-label={`${p.unread} unread`}>{p.unread}</span>{/if}
            </button>
          </li>
        {:else}
          <li class="empty-list">No chats yet. Add your other device’s key above, or scan the QR code with it.</li>
        {/each}
      </ul>

      <p class="privacy readout">
        {engine.persistent ? 'Chats are saved only on this device.' : 'This browser blocks storage — chats vanish on reload.'}
      </p>
    </aside>

    <!-- ================= Chat pane ================= -->
    <section
      class="chat"
      class:dragging
      aria-label="Chat"
      ondragover={onDragOver}
      ondragleave={() => (dragging = false)}
      ondrop={onDrop}
      onpaste={onPaste}
    >
      {#if !activePeer}
        <div class="welcome">
          <button type="button" class="fs-btn floating" onclick={toggleFullscreen} aria-pressed={fullscreen}>
            {fullscreen ? 'Exit full screen' : 'Full screen'}
          </button>
          <h2>Your private line between devices</h2>
          <ol>
            <li>Open this page on your other device — it gets its own permanent key automatically.</li>
            <li>Scan the QR code with it, or type its key into <strong>Add a device</strong>.</li>
            <li>Pick the chat and type, paste text, or drop in images. It’s instant and goes straight between the two devices.</li>
          </ol>
          <p class="hint">Offline? Messages wait and send themselves the moment the other device is back.</p>
        </div>
      {:else}
        <header class="chat-head">
          <button type="button" class="back-btn" onclick={() => engine.openChat(null)} aria-label="Back to chats">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <div class="chat-title">
            {#if editingPeer}
              <input
                class="inline-input"
                aria-label="Chat name"
                maxlength="40"
                placeholder={engine.displayName({ ...activePeer, nickname: undefined })}
                bind:value={peerDraft}
                onblur={commitRenamePeer}
                onkeydown={(e) => {
                  if (e.key === 'Enter') commitRenamePeer();
                  if (e.key === 'Escape') editingPeer = false;
                }}
              />
            {:else}
              <button type="button" class="title-btn" onclick={beginRenamePeer} title="Rename this chat">
                {engine.displayName(activePeer)}
              </button>
            {/if}
            <span class="chat-status"><span class="dot dot-{dotOf(activePeer)}" aria-hidden="true"></span>{statusOf(activePeer)} · <span class="readout">{formatKey(activePeer.key)}</span></span>
          </div>
          <div class="head-actions">
            <button type="button" class="fs-btn" onclick={toggleFullscreen} aria-pressed={fullscreen}>
              {fullscreen ? 'Exit full screen' : 'Full screen'}
            </button>
            <div class="menu-wrap">
              <button type="button" class="btn icon" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Chat options" onclick={() => (menuOpen = !menuOpen)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
              </button>
              {#if menuOpen}
                <div class="menu" role="menu">
                  <button type="button" role="menuitem" onclick={beginRenamePeer}>Rename chat</button>
                  <button type="button" role="menuitem" onclick={clearChat}>Clear messages</button>
                  <button type="button" role="menuitem" class="danger" onclick={removeChat}>Remove chat</button>
                </div>
              {/if}
            </div>
          </div>
        </header>

        <div class="messages" bind:this={listEl} role="log" aria-live="polite" aria-label="Messages">
          {#if thread.length === 0}
            <p class="empty-thread">
              No messages yet. Type below, paste text, or drop an image — anything you send while they’re away is
              delivered when they’re back.
            </p>
          {/if}
          {#each thread as m, i (m.id)}
            {#if newDay(i)}<p class="day">{dayLabel(m.ts)}</p>{/if}
            <div class="row" class:out={m.dir === 'out'}>
              <div class="bubble" class:image={m.kind === 'image'}>
                {#if m.kind === 'image'}
                  <button
                    type="button"
                    class="img-btn"
                    aria-label={`Open image ${m.name ?? ''}`}
                    onclick={() => (lightbox = { url: urlFor(m), name: m.name ?? 'image', blob: m.blob! })}
                  >
                    <img src={urlFor(m)} alt={m.name ?? 'Shared image'} loading="lazy" />
                  </button>
                {:else}
                  <p class="text">{m.text}</p>
                {/if}
                <span class="meta readout">
                  {clock(m.ts)}{#if m.dir === 'out'}&nbsp;·&nbsp;{m.status === 'delivered' ? 'delivered' : m.status === 'sent' ? 'sent' : 'waiting…'}{/if}
                </span>
                {#if m.kind === 'text'}
                  <button type="button" class="copy-btn" onclick={() => copy(m.text ?? '', m.id)} aria-label="Copy message">
                    {copied === m.id ? 'Copied' : 'Copy'}
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <div class="composer">
          <input bind:this={fileInput} type="file" accept="image/*" multiple hidden onchange={pickFiles} />
          <button type="button" class="btn icon" aria-label="Attach an image" title="Attach an image" onclick={() => fileInput?.click()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-8 9" /></svg>
          </button>
          <textarea
            bind:this={composer}
            bind:value={draft}
            rows="1"
            placeholder={coarsePointer ? 'Message' : 'Type a message — Enter to send, Shift+Enter for a new line'}
            aria-label="Message"
            oninput={autosize}
            onkeydown={onComposerKey}
            enterkeyhint="send"
          ></textarea>
          <button type="button" class="btn primary send" onclick={send} disabled={!draft.trim()}>Send</button>
        </div>

        {#if dragging}<div class="drop-hint">Drop images to send</div>{/if}
      {/if}

      {#if engine.notice}<p class="toast" role="status">{engine.notice}</p>{/if}
    </section>

    {#if lightbox}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="lightbox" onclick={() => (lightbox = null)}>
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="lb-bar" onclick={(e) => e.stopPropagation()}>
          <a class="btn" href={lightbox.url} download={lightbox.name}>Save</a>
          <button type="button" class="btn" onclick={() => copyImage(lightbox!.blob)}>{copied === 'image' ? 'Copied' : 'Copy image'}</button>
          <button type="button" class="btn primary" onclick={() => (lightbox = null)}>Close</button>
        </div>
        <img src={lightbox.url} alt={lightbox.name} onclick={(e) => e.stopPropagation()} />
      </div>
    {/if}
  </div>
{/if}

<style>
  .app {
    --pane-h: min(80vh, 760px);
    display: grid;
    grid-template-columns: minmax(280px, 340px) 1fr;
    height: var(--pane-h);
    min-height: 520px;
    border: 1px solid var(--border-strong);
    background: var(--bg-raised);
    position: relative;
  }

  .app.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 9999;
    height: 100dvh;
    min-height: 0;
    border: 0;
    background: var(--bg-raised);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  /* ---------- Sidebar ---------- */
  .side {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    border-right: 1px solid var(--border-strong);
    overflow-y: auto;
    min-width: 0;
  }

  .side-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }

  .side-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-lg);
  }

  .label {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-faint);
  }

  .me {
    border: 1px solid var(--border-strong);
    background: var(--bg);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .me-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }

  .key-label {
    margin-top: var(--space-1);
    text-transform: none;
    letter-spacing: 0;
  }

  .mykey {
    margin: 0;
    font-size: var(--text-xl);
    letter-spacing: 0.1em;
    line-height: 1.1;
    user-select: all;
  }

  .btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--fg);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius-md);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    transition: border-color var(--duration-tick) var(--ease-snap), color var(--duration-tick) var(--ease-snap);
  }

  .btn:hover:not(:disabled) {
    border-color: var(--signal-text);
    color: var(--signal-text);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.primary {
    background: var(--fg);
    color: var(--bg);
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--signal-text);
    border-color: var(--signal-text);
    color: var(--bg);
  }

  .btn.small {
    min-height: 30px;
    padding: var(--space-1) var(--space-3);
  }

  .btn.icon {
    padding: 0;
    width: 40px;
    min-height: 40px;
    flex: none;
  }

  .btn:focus-visible,
  .link-btn:focus-visible,
  .title-btn:focus-visible,
  .chat-item:focus-visible,
  .fs-btn:focus-visible,
  .img-btn:focus-visible,
  .copy-btn:focus-visible,
  .menu button:focus-visible,
  input:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .link-btn {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-size: var(--text-sm);
    color: var(--fg);
    cursor: pointer;
    text-align: right;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link-btn.danger {
    color: var(--fg-faint);
    font-size: var(--text-xs);
    text-decoration: underline;
    text-align: left;
  }

  .edit-hint {
    font-size: var(--text-xs);
    color: var(--fg-faint);
    text-decoration: underline;
  }

  .inline-input,
  .add-row input {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--text-sm);
    min-width: 0;
  }

  .inline-input {
    flex: 1;
    padding: var(--space-1) var(--space-2);
  }

  .qr {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border);
  }

  .qr-wrap {
    background: #fff;
    border: 1px solid var(--border-strong);
    padding: var(--space-2);
    line-height: 0;
  }

  .qr-wrap canvas {
    width: 160px;
    height: 160px;
    display: block;
  }

  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--fg-soft);
    line-height: 1.45;
  }

  .add {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .add-row {
    display: flex;
    gap: var(--space-2);
  }

  .add-row input {
    flex: 1;
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
    min-height: 40px;
  }

  .add-row input::placeholder {
    font-family: var(--font-ui);
    letter-spacing: 0;
  }

  .field-error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--signal-text);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .request {
    border: 1px solid var(--signal-text);
    background: var(--bg);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .request-name {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--text-sm);
    word-break: break-word;
  }

  .request-name .readout {
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }

  .banner {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
    border: 1px solid var(--signal-text);
    padding: var(--space-3);
    font-size: var(--text-sm);
  }

  .chat-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .empty-list {
    font-size: var(--text-sm);
    color: var(--fg-soft);
    padding: var(--space-3) 0;
    line-height: 1.5;
  }

  .chat-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    padding: var(--space-3);
    cursor: pointer;
    color: var(--fg);
    font: inherit;
    min-height: 56px;
  }

  .chat-item:hover {
    border-color: var(--border);
    background: var(--bg);
  }

  .chat-item.selected {
    border-color: var(--border-strong);
    background: var(--bg);
  }

  .chat-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .chat-name {
    font-weight: 600;
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .short-key {
    font-family: var(--font-mono);
    font-weight: 400;
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }

  .chat-preview {
    font-size: var(--text-xs);
    color: var(--fg-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    min-width: 20px;
    padding: 0 6px;
    height: 20px;
    border-radius: 10px;
    background: var(--signal-text);
    color: var(--bg);
    font-size: var(--text-xs);
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: none;
    background: var(--fg-faint);
    opacity: 0.55;
    display: inline-block;
  }

  .dot-live {
    background: #2f9e44;
    opacity: 1;
  }

  .dot-ready {
    background: var(--signal);
    opacity: 1;
  }

  .privacy {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }

  /* ---------- Chat pane ---------- */
  .chat {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg);
    position: relative;
  }

  .chat.dragging {
    outline: 2px dashed var(--signal-text);
    outline-offset: -8px;
  }

  .welcome {
    margin: auto;
    max-width: 460px;
    padding: var(--space-6) var(--space-5);
  }

  .welcome h2 {
    margin: 0 0 var(--space-4);
    font-family: var(--font-display);
    font-size: var(--text-lg);
  }

  .welcome ol {
    padding-left: 1.2em;
    margin: 0 0 var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    color: var(--fg-soft);
    line-height: 1.5;
  }

  .fs-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-3);
    min-height: 32px;
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .fs-btn:hover {
    border-color: var(--signal-text);
    color: var(--signal-text);
  }

  .fs-btn.floating {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
  }

  .chat-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-strong);
    background: var(--bg-raised);
  }

  .back-btn {
    display: none;
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--fg);
    border-radius: var(--radius-md);
    width: 40px;
    height: 40px;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex: none;
  }

  .chat-title {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .title-btn {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-weight: 600;
    font-size: var(--text-base);
    color: var(--fg);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--fg-faint);
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }

  .menu-wrap {
    position: relative;
  }

  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 5;
    min-width: 170px;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-instrument);
    display: flex;
    flex-direction: column;
  }

  .menu button {
    background: none;
    border: 0;
    text-align: left;
    font: inherit;
    font-size: var(--text-sm);
    color: var(--fg);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
  }

  .menu button:hover {
    background: var(--bg-raised);
  }

  .menu .danger {
    color: var(--signal-text);
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    background-image:
      linear-gradient(var(--grid-line) 1px, transparent 1px),
      linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
    background-size: var(--grid-size) var(--grid-size);
  }

  .empty-thread {
    margin: auto;
    max-width: 340px;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--fg-soft);
    line-height: 1.5;
  }

  .day {
    align-self: center;
    margin: var(--space-2) 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--fg-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .row {
    display: flex;
  }

  .row.out {
    justify-content: flex-end;
  }

  .bubble {
    position: relative;
    max-width: min(78%, 560px);
    padding: var(--space-2) var(--space-3) var(--space-1);
    border: 1px solid var(--border);
    background: var(--bg-raised);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .row.out .bubble {
    border-color: var(--signal-text);
    background: color-mix(in srgb, var(--signal) 10%, var(--bg));
  }

  .bubble.image {
    padding: var(--space-1);
  }

  .text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.45;
    padding-right: 44px;
  }

  .meta {
    align-self: flex-end;
    font-size: 0.6875rem;
    color: var(--fg-faint);
    padding: 0 var(--space-1);
  }

  .copy-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--fg-soft);
    font: inherit;
    font-size: 0.6875rem;
    padding: 1px 6px;
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--duration-tick) var(--ease-snap);
  }

  .bubble:hover .copy-btn,
  .copy-btn:focus-visible {
    opacity: 1;
  }

  @media (hover: none) {
    .copy-btn {
      opacity: 1;
    }
  }

  .img-btn {
    background: none;
    border: 0;
    padding: 0;
    cursor: zoom-in;
    line-height: 0;
  }

  .img-btn img {
    max-width: 100%;
    max-height: 320px;
    border-radius: var(--radius-sm);
    display: block;
  }

  .composer {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border-strong);
    background: var(--bg-raised);
  }

  .composer textarea {
    flex: 1;
    resize: none;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: 10px var(--space-3);
    font: inherit;
    line-height: 1.4;
    max-height: 160px;
    min-height: 40px;
    min-width: 0;
  }

  .send {
    min-height: 40px;
    padding: 0 var(--space-5);
  }

  .drop-hint {
    position: absolute;
    inset: auto 0 76px 0;
    text-align: center;
    pointer-events: none;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--signal-text);
  }

  .toast {
    position: absolute;
    left: 50%;
    bottom: 84px;
    transform: translateX(-50%);
    margin: 0;
    max-width: calc(100% - 32px);
    background: var(--fg);
    color: var(--bg);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    z-index: 6;
  }

  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: rgba(10, 10, 10, 0.88);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .lightbox img {
    max-width: 100%;
    max-height: calc(100dvh - 120px);
    object-fit: contain;
    background: #fff;
  }

  .lb-bar {
    display: flex;
    gap: var(--space-2);
  }

  .lb-bar .btn:not(.primary) {
    background: var(--bg);
  }

  .notice {
    font-size: var(--text-sm);
    color: var(--fg-soft);
    border: 1px solid var(--border-strong);
    background: var(--bg);
    padding: var(--space-4);
    margin: 0;
  }

  /* ---------- Phones: one pane at a time ---------- */
  @media (max-width: 720px) {
    .app {
      grid-template-columns: 1fr;
      height: min(86vh, 760px);
    }

    .app.chat-open .side,
    .app:not(.chat-open) .chat {
      display: none;
    }

    .side {
      border-right: 0;
    }

    .back-btn {
      display: inline-flex;
    }

    .bubble {
      max-width: 88%;
    }

    .composer {
      padding: var(--space-2) var(--space-3);
      padding-bottom: max(var(--space-2), env(safe-area-inset-bottom));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .copy-btn {
      transition: none;
    }
  }
</style>

import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// This spec exercises two unrelated but adjacent NABL Tools capabilities:
//
//   1. File Drop's two-device peer-to-peer transfer, against a REAL local
//      signaling server (Cloudflare Worker + Durable Object run via
//      `wrangler dev --local` on ws://localhost:8787). Requires the site to
//      be built with PUBLIC_SIGNALING_URL pointed at that server (a plain
//      shell-exported env var is NOT picked up by `astro build` in this
//      repo — it must go through a `.env.local` file; see the QA report).
//
//   2. The PWA's offline behavior via public/sw.js, against a standard
//      `astro preview` build. No signaling server involved here.
//
// Run with e.g.:
//   BASE_URL=http://127.0.0.1:5006 npx playwright test file-drop-and-pwa

const FIXTURE_FILE = path.resolve(import.meta.dirname, '../fixtures/text-image.png');

// --- File Drop helpers ---------------------------------------------------

async function waitForCode(page: Page): Promise<string> {
  const codeLocator = page.locator('.pairing-details p.code');
  await expect(codeLocator).not.toHaveText('——————', { timeout: 10_000 });
  const text = (await codeLocator.textContent())?.trim() ?? '';
  expect(text, 'host session code should be a 6-character alphanumeric code').toMatch(/^[A-Z0-9]{6}$/);
  return text;
}

async function waitForConnected(page: Page, label: string) {
  // Led primitive renders `led led-{state}`; 'live' is the connected state,
  // driven by `peerStatus === 'connected'` (i.e. the RTCDataChannel opened).
  await expect(page.locator('.led'), `${label}: LED should reach the connected ("live") state`).toHaveClass(
    /led-live/,
    { timeout: 20_000 },
  );
  await expect(page.locator('.led .led-label'), `${label}: LED label should read Connected`).toHaveText(
    /Connected|Transferring/,
    { timeout: 5_000 },
  );
}

test.describe('File Drop — real two-device pairing + transfer', () => {
  test('pairs two independent browser contexts over local signaling and transfers a file peer-to-peer', async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    const ctxA = await browser.newContext({ acceptDownloads: true });
    const ctxB = await browser.newContext({ acceptDownloads: true });
    const pageA = await ctxA.newPage();

    // Capture every WebSocket frame *sent by* device A's signaling socket,
    // from before pairing starts, so we can later prove the channel only
    // ever carried small SDP/ICE JSON — never file bytes. This is the
    // Trust Meter claim under direct test: "signaling carries no file
    // data".
    const signalingFramesSent: (string | Buffer)[] = [];
    pageA.on('websocket', (ws) => {
      if (!ws.url().includes('/ws/filedrop/')) return;
      ws.on('framesent', (frame) => {
        signalingFramesSent.push(frame.payload);
      });
    });

    // --- Device A: host --------------------------------------------------
    await pageA.goto('/file-drop');
    const code = await waitForCode(pageA);

    // --- Device B: joiner, via the same `?join=<code>` URL shape the UI's
    // own "copy pairing link" button produces --------------------------
    const pageB = await ctxB.newPage();
    await pageB.goto(`/file-drop?join=${code}`);

    // --- Real WebRTC negotiation over the real local signaling server ---
    await Promise.all([waitForConnected(pageA, 'Host (A)'), waitForConnected(pageB, 'Joiner (B)')]);

    // --- Real file transfer, peer-to-peer over the RTCDataChannel -------
    const originalBytes = await fs.readFile(FIXTURE_FILE);
    const originalHash = crypto.createHash('sha256').update(originalBytes).digest('hex');

    const downloadPromise = pageB.waitForEvent('download', { timeout: 30_000 });
    await pageA.locator('.dropzone input[type="file"]').setInputFiles(FIXTURE_FILE);

    const download = await downloadPromise;
    const downloadedPath = await download.path();
    expect(downloadedPath, 'download should have saved to a real local file').not.toBeNull();
    const receivedBytes = await fs.readFile(downloadedPath!);
    const receivedHash = crypto.createHash('sha256').update(receivedBytes).digest('hex');

    expect(receivedBytes.length, 'received file size should exactly match the sent file').toBe(originalBytes.length);
    expect(receivedHash, 'SHA-256 of the received file must exactly match the original — proves the P2P transfer was byte-exact').toBe(
      originalHash,
    );

    // Both sides' UI should reflect a completed transfer.
    await expect(pageA.locator('.transfers')).toContainText(/done/i, { timeout: 10_000 });
    await expect(pageB.locator('.transfers')).toContainText(/done/i, { timeout: 10_000 });

    // --- Trust Meter claim: the signaling channel never carried file data
    expect(signalingFramesSent.length, 'expected at least one SDP/ICE signaling frame to have been sent').toBeGreaterThan(0);

    const MAX_SIGNAL_MESSAGE_BYTES = 16 * 1024; // matches workers/filedrop/src/index.ts
    for (const payload of signalingFramesSent) {
      const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');

      // Structural proof: every frame is small JSON shaped like a signaling
      // message (`kind: 'sdp' | 'ice'`, or the initial role announcements),
      // never a raw/binary file chunk.
      expect(buf.byteLength, `signaling frame exceeds the server's ${MAX_SIGNAL_MESSAGE_BYTES}-byte cap`).toBeLessThan(
        MAX_SIGNAL_MESSAGE_BYTES,
      );
      let parsed: Record<string, unknown>;
      expect(() => {
        parsed = JSON.parse(buf.toString('utf8'));
      }, 'every signaling frame must be valid JSON, not raw binary file data').not.toThrow();
      expect(
        ['sdp', 'ice', undefined].includes((parsed! as Record<string, unknown>).kind as string | undefined),
        `unexpected signaling frame shape: ${buf.toString('utf8').slice(0, 200)}`,
      ).toBe(true);

      // Belt-and-braces: the exact byte sequence of the transferred file
      // must never appear inside a signaling frame.
      expect(buf.includes(originalBytes), 'signaling frame must never contain the transferred file bytes').toBe(false);
    }

    await ctxA.close();
    await ctxB.close();
  });
});

// --- PWA offline tests -----------------------------------------------------

test.describe('PWA offline behavior (public/sw.js)', () => {
  test('a previously-visited tool page still renders correctly after going offline', async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/favicon-generator');
    // Wait for the service worker registered in BaseLayout.astro to install
    // and become the active controller, so its install-time precache (and
    // this page's own network-first cache.put) has actually happened.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    // Give the fetch-handler's cache.put() for this navigation response (and
    // its static asset chunks) a brief moment to land before we go offline.
    await page.waitForTimeout(1000);

    await context.setOffline(true);
    await page.reload();

    await expect(page.locator('h1')).toHaveText('Favicon & Icon Generator', { timeout: 10_000 });
    // Tool UI (the Dropzone primitive) should be present and interactive,
    // not a browser offline error page.
    await expect(page.getByText(/drop a square image/i)).toBeVisible();

    await context.close();
  });

  test('the service worker cache-fallback code path serves OFFLINE_FALLBACK_HTML when nothing else matches', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext();
    const page = await context.newPage();

    // Install the SW via a normal online visit first.
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.waitForTimeout(1000);

    // `networkFirst()` in public/sw.js falls back, in order, to: (1) a
    // cache hit for the exact request, (2) a cache hit for '/', then only
    // (3) the inline OFFLINE_FALLBACK_HTML. Because '/' is part of
    // APP_SHELL and is precached on every install, step (2) will normally
    // catch every offline navigation to an uncached page before step (3) is
    // ever reached — see the QA report for why this makes the dedicated
    // "You're offline" fallback effectively unreachable in real usage. To
    // actually exercise step (3)'s code, we evict '/' from every cache the
    // SW owns, then request a page that was never visited/cached.
    await page.evaluate(async () => {
      const names = await caches.keys();
      for (const name of names) {
        const cache = await caches.open(name);
        await cache.delete('/');
      }
    });

    await context.setOffline(true);
    // `/webcam-test` was never visited in this context/browser and is not
    // part of APP_SHELL, so it has no cache entry of its own either.
    const response = await page.goto('/webcam-test', { waitUntil: 'load' }).catch(() => null);
    expect(response, 'navigation should still resolve to a response, not a raw browser network error').not.toBeNull();

    await expect(page.locator('h1')).toHaveText("You're offline", { timeout: 10_000 });
    await expect(page.getByText(/reconnect and reload to try again/i)).toBeVisible();

    await context.close();
  });

  test('documents actual behavior for a never-visited page while offline (with an intact SW cache)', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext();
    const page = await context.newPage();

    // Prime the SW with an ordinary online visit (installs APP_SHELL,
    // including '/').
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.waitForTimeout(1000);

    await context.setOffline(true);
    // A tool page never visited in this context and not part of APP_SHELL.
    const response = await page.goto('/webcam-test', { waitUntil: 'load' }).catch(() => null);
    expect(response, 'navigation should still resolve to a response, not a raw browser network error').not.toBeNull();

    const h1Text = (await page.locator('h1').first().textContent())?.trim();
    // Documented finding (see QA report): because '/' is precached as part
    // of APP_SHELL, `networkFirst()` serves the cached home page here
    // rather than the dedicated OFFLINE_FALLBACK_HTML — the page is never a
    // raw browser error, but it is also not the "You're offline" notice a
    // reader of sw.js might expect for an unvisited page.
    expect(h1Text, 'should not be a raw browser error page').toBeTruthy();
    console.log(`[finding] never-visited page while offline rendered h1: "${h1Text}"`);

    await context.close();
  });
});

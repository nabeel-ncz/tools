import { test, expect, type Page, type Request } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const CLIP_PATH = path.resolve(import.meta.dirname, '../fixtures/clip.webm');

// --- byte-header helpers -----------------------------------------------

function isWebm(buf: Buffer) {
  return buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

function isMp4(buf: Buffer) {
  // 'ftyp' box: 4-byte size, then ASCII 'ftyp' at offset 4..8. Allow a small
  // search window since some muxers vary the leading box.
  const needle = Buffer.from('ftyp', 'ascii');
  return buf.subarray(0, 32).includes(needle);
}

function isGif(buf: Buffer) {
  const s = buf.subarray(0, 6).toString('ascii');
  return s === 'GIF87a' || s === 'GIF89a';
}

async function readDownload(download: import('@playwright/test').Download): Promise<Buffer> {
  const tmp = path.join(os.tmpdir(), `nabl-dl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await download.saveAs(tmp);
  const buf = await fs.readFile(tmp);
  await fs.rm(tmp, { force: true });
  return buf;
}

// Astro hydrates `client:visible` islands asynchronously (fetch + init of
// the component chunk after an IntersectionObserver fires). On a very fast
// local server this can occasionally still be in flight the instant the
// page is considered "loaded", so a `setInputFiles` fired immediately after
// `goto` can land before the Svelte `onchange` listener is wired up. Wait
// for the network to go quiet, then retry the upload once if the tool's
// reaction (revealing the trim UI) doesn't show up in time.
async function uploadClip(page: Page, clipPath: string) {
  await page.waitForLoadState('networkidle');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(clipPath);
  try {
    await expect(page.getByText(/in point/i)).toBeVisible({ timeout: 5_000 });
  } catch {
    await fileInput.setInputFiles(clipPath);
    await expect(page.getByText(/in point/i)).toBeVisible({ timeout: 15_000 });
  }
}

function trackRequests(page: Page) {
  const writes: Request[] = [];
  const crossOriginCdnGets: Request[] = [];
  page.on('request', (req) => {
    const method = req.method();
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      writes.push(req);
    }
    if (method === 'GET') {
      const url = req.url();
      if (/(^https?:\/\/)?([^/]*\.)?(unpkg\.com|jsdelivr\.net)/i.test(url)) {
        crossOriginCdnGets.push(req);
      }
    }
  });
  return { writes, crossOriginCdnGets };
}

async function assertNoUploads(page: Page, writes: Request[]) {
  expect(writes, `expected no POST/PUT/PATCH requests, saw: ${writes.map((r) => r.url()).join(', ')}`).toHaveLength(0);
  await expect(page.locator('.trust-meter .tm-key')).toHaveText('Uploaded');
  await expect(page.locator('.trust-meter .tm-value')).toHaveText('0 bytes');
}

// =========================================================================
// Screen Recorder
// =========================================================================

test.describe('Screen Recorder', () => {
  test('records screen only (mic/webcam off) and downloads a valid WebM', async ({ page }) => {
    test.setTimeout(90_000);
    const { writes } = trackRequests(page);

    await page.goto('/screen-recorder');
    await expect(page.getByRole('button', { name: /start recording/i })).toBeVisible();

    // Mic and webcam toggles should both read Off by default.
    await expect(page.getByRole('button', { name: /microphone: off/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /webcam bubble: off/i })).toBeVisible();

    await page.getByRole('button', { name: /start recording/i }).click();

    // getDisplayMedia is auto-granted/auto-selected by the launch flags, so
    // the tool should move straight into the live state.
    await expect(page.locator('.led-live')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/recording/i).first()).toBeVisible();

    // Let it record for a couple of seconds and confirm the elapsed-time
    // readout actually ticks up (not stuck at 00:00).
    const timeReadout = page.locator('.hud-time');
    await expect(timeReadout).toBeVisible();
    const t0 = (await timeReadout.textContent())?.trim();
    await page.waitForTimeout(2500);
    const t1 = (await timeReadout.textContent())?.trim();
    expect(t1, 'elapsed time readout should tick up while recording').not.toBe(t0);

    await page.getByRole('button', { name: /stop recording/i }).click();

    const downloadLink = page.getByRole('link', { name: /download recording/i });
    await expect(downloadLink).toBeVisible({ timeout: 20_000 });

    const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
    const buf = await readDownload(download);

    expect(buf.length, 'downloaded recording should be non-empty').toBeGreaterThan(0);
    expect(isWebm(buf), `expected EBML magic bytes at start of file, got ${buf.subarray(0, 4).toString('hex')}`).toBe(
      true
    );

    await assertNoUploads(page, writes);
  });

  test('records with mic and webcam bubble on and downloads a valid WebM', async ({ page, context }) => {
    test.setTimeout(90_000);
    await context.grantPermissions(['camera', 'microphone']);
    const { writes } = trackRequests(page);

    await page.goto('/screen-recorder');
    await expect(page.getByRole('button', { name: /start recording/i })).toBeVisible();

    await page.getByRole('button', { name: /microphone: off/i }).click();
    await expect(page.getByRole('button', { name: /microphone: on/i })).toBeVisible();

    await page.getByRole('button', { name: /webcam bubble: off/i }).click();
    await expect(page.getByRole('button', { name: /webcam bubble: on/i })).toBeVisible();

    await page.getByRole('button', { name: /start recording/i }).click();

    await expect(page.locator('.led-live')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.source-note')).toHaveText(/mic on/i);
    await expect(page.locator('.source-note')).toHaveText(/webcam bubble on/i);

    await page.waitForTimeout(2500);

    await page.getByRole('button', { name: /stop recording/i }).click();

    const downloadLink = page.getByRole('link', { name: /download recording/i });
    await expect(downloadLink).toBeVisible({ timeout: 20_000 });

    const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
    const buf = await readDownload(download);

    expect(buf.length, 'downloaded recording (mic+webcam) should be non-empty').toBeGreaterThan(0);
    expect(isWebm(buf)).toBe(true);

    await assertNoUploads(page, writes);
  });
});

// =========================================================================
// Video Compressor
// =========================================================================

test.describe('Video Trimmer & Compressor', () => {
  test('trims + compresses to MP4 (default format) and downloads a valid, right-sized file', async ({ page }) => {
    test.setTimeout(180_000);
    const { writes, crossOriginCdnGets } = trackRequests(page);

    await page.goto('/video-compressor');
    await uploadClip(page, CLIP_PATH);

    // Narrow the trim slightly by nudging the out-point slider down, to also
    // exercise the trim path (clip is ~3s; a native range input responds to
    // arrow-key presses).
    const outSlider = page.locator('input[type="range"]').nth(1);
    await outSlider.focus();
    await outSlider.press('ArrowLeft');
    await outSlider.press('ArrowLeft');

    // Default output format should already be MP4.
    await expect(page.getByRole('button', { name: 'MP4', exact: true })).toHaveClass(/active/);

    await page.getByRole('button', { name: 'Export' }).click();

    // First run pays for engine load (self-hosted @ffmpeg/core) + a real
    // WASM transcode, so allow generous time.
    const downloadLink = page.getByRole('link', { name: /^download mp4$/i });
    await expect(downloadLink).toBeVisible({ timeout: 150_000 });

    const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
    const buf = await readDownload(download);

    expect(buf.length, 'downloaded MP4 should be non-empty').toBeGreaterThan(0);
    expect(isMp4(buf), `expected an ftyp box near the start of the file, got ${buf.subarray(0, 32).toString('hex')}`).toBe(
      true
    );

    // Cross-check the UI's own "After" size readout against the real file.
    const afterText = await page.locator('.size-compare').getByText(/^After:/).textContent();
    const afterMatch = afterText?.match(/After:\s*([\d.]+)\s*(B|KB|MB)/i);
    expect(afterMatch, `could not parse After readout: ${afterText}`).not.toBeNull();
    const [, num, unit] = afterMatch!;
    const multiplier = unit.toUpperCase() === 'MB' ? 1024 * 1024 : unit.toUpperCase() === 'KB' ? 1024 : 1;
    const uiReportedSize = parseFloat(num) * multiplier;
    // formatBytes rounds to 1 decimal, so allow a tolerance band relative to
    // that rounding plus the unit's own granularity.
    const tolerance = Math.max(multiplier, uiReportedSize * 0.02);
    expect(
      Math.abs(uiReportedSize - buf.length),
      `UI-reported size ${uiReportedSize}B should be close to actual downloaded size ${buf.length}B`
    ).toBeLessThanOrEqual(tolerance);

    // Confirm the self-hosted engine fix actually held: no fetches ever went
    // to the CDN hosts the old code used, and everything (including the
    // wasm core) loaded same-origin.
    expect(
      crossOriginCdnGets,
      `expected zero requests to unpkg.com/jsdelivr.net, saw: ${crossOriginCdnGets.map((r) => r.url()).join(', ')}`
    ).toHaveLength(0);

    await assertNoUploads(page, writes);
  });

  test('exports GIF output and downloads a valid GIF', async ({ page }) => {
    test.setTimeout(180_000);
    const { writes, crossOriginCdnGets } = trackRequests(page);

    await page.goto('/video-compressor');
    await uploadClip(page, CLIP_PATH);

    await page.getByRole('button', { name: 'GIF', exact: true }).click();
    await expect(page.getByRole('button', { name: 'GIF', exact: true })).toHaveClass(/active/);

    await page.getByRole('button', { name: 'Export' }).click();

    const downloadLink = page.getByRole('link', { name: /^download gif$/i });
    await expect(downloadLink).toBeVisible({ timeout: 150_000 });

    const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
    const buf = await readDownload(download);

    expect(buf.length, 'downloaded GIF should be non-empty').toBeGreaterThan(0);
    expect(isGif(buf), `expected GIF87a/GIF89a magic bytes, got ${buf.subarray(0, 6).toString('ascii')}`).toBe(true);

    expect(crossOriginCdnGets).toHaveLength(0);
    await assertNoUploads(page, writes);
  });
});

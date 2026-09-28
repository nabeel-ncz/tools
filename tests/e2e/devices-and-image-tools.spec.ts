import { test, expect, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures');
const SCREENSHOT_SOURCE = path.join(FIXTURES, 'screenshot-source.png');
const ICON_SOURCE = path.join(FIXTURES, 'icon-source.png');

/** These tools claim to be 100% client-side. Any POST/PUT/PATCH is a real bug. */
function trackUploadLikeRequests(page: Page): Request[] {
  const offenders: Request[] = [];
  page.on('request', (req) => {
    const method = req.method();
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      offenders.push(req);
    }
  });
  return offenders;
}

async function expectTrustMeterIdle(page: Page) {
  const trustMeter = page.locator('.trust-meter');
  await expect(trustMeter.locator('.tm-key')).toHaveText('Uploaded');
  await expect(trustMeter.locator('.tm-value')).toHaveText('0 bytes');
}

test.describe('Webcam Test', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['camera']);
  });

  test('starting the camera shows a live feed with resolution/FPS readout and never uploads anything', async ({ page }) => {
    const offenders = trackUploadLikeRequests(page);

    await page.goto('/webcam-test/');
    await expectTrustMeterIdle(page);

    // Idle state: LED off, no HUD spec readout yet.
    await expect(page.locator('.led')).toHaveClass(/led-off/);
    await expect(page.locator('.hud-spec')).toHaveCount(0);

    await page.getByRole('button', { name: 'Start camera' }).click();

    // LED should flip to the "live" state once getUserMedia resolves against
    // Chromium's fake video capture device.
    await expect(page.locator('.led')).toHaveClass(/led-live/, { timeout: 15_000 });
    await expect(page.getByRole('status', { name: 'Live' })).toBeVisible();

    // Resolution/FPS readout, e.g. "640×480 · 30 FPS".
    const hudSpec = page.locator('.hud-spec');
    await expect(hudSpec).toBeVisible();
    await expect(hudSpec).toHaveText(/^\d+×\d+ · \d+ FPS$/);

    // Give the FPS counter (which ticks once per second) a chance to report
    // a non-zero frame rate from the fake camera's synthetic video stream.
    await expect
      .poll(
        async () => {
          const text = await hudSpec.textContent();
          const match = text?.match(/· (\d+) FPS$/);
          return match ? Number(match[1]) : 0;
        },
        { timeout: 10_000, message: 'expected the FPS readout to report frames from the fake camera' }
      )
      .toBeGreaterThan(0);

    // The video preview element should actually have the fake stream attached.
    const video = page.locator('video[aria-label="Camera preview"]');
    await expect(video).toBeVisible();
    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.videoWidth > 0 && el.videoHeight > 0), {
        timeout: 10_000,
      })
      .toBe(true);

    // The tool is 100% local: nothing about the camera feed should ever
    // leave the device, and the trust meter should reflect that.
    await expectTrustMeterIdle(page);
    expect(offenders, `unexpected upload-like requests: ${offenders.map((r) => `${r.method()} ${r.url()}`).join(', ')}`).toHaveLength(0);

    // Stopping the camera should return to idle.
    await page.getByRole('button', { name: 'Stop camera' }).click();
    await expect(page.locator('.led')).toHaveClass(/led-off/);
  });
});

test.describe('Mic Test', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['microphone']);
  });

  test('starting the mic test shows live VU meter movement fed by the fake mic, records a clip, and never uploads anything', async ({
    page,
  }) => {
    const offenders = trackUploadLikeRequests(page);

    await page.goto('/mic-test/');
    await expectTrustMeterIdle(page);

    await expect(page.locator('.led')).toHaveClass(/led-off/);

    await page.getByRole('button', { name: 'Start microphone test' }).click();

    await expect(page.locator('.led')).toHaveClass(/led-live/, { timeout: 15_000 });
    await expect(page.getByRole('status', { name: 'Live' })).toBeVisible();

    const meter = page.locator('.meter[aria-label="Input level"]');
    await expect(meter).toBeVisible();

    // The fake microphone is fed a real speech .wav via the browser launch
    // flag (--use-file-for-fake-audio-capture), so the RMS-based VU meter
    // should move off zero as that audio plays through the AnalyserNode.
    const readings: number[] = [];
    for (let i = 0; i < 8; i++) {
      const value = await meter.getAttribute('aria-valuenow');
      readings.push(Number(value ?? 0));
      await page.waitForTimeout(300);
    }
    expect(
      readings.some((v) => v > 0),
      `expected at least one non-zero VU reading from the fake mic's speech audio, got: ${readings.join(', ')}`
    ).toBe(true);
    // "Movement" — not just a single stuck non-zero value the whole time.
    const distinctReadings = new Set(readings);
    expect(distinctReadings.size, `expected the VU meter to vary over time, got constant readings: ${readings.join(', ')}`).toBeGreaterThan(1);

    // Record a short test clip and confirm a real playable <audio> element appears.
    await expect(page.locator('audio')).toHaveCount(0);
    await page.getByRole('button', { name: 'Record a test clip' }).click();
    await expect(page.getByRole('button', { name: 'Stop 3s test clip' })).toBeVisible();
    await page.waitForTimeout(1_000);
    await page.getByRole('button', { name: 'Stop 3s test clip' }).click();

    const audio = page.locator('audio');
    await expect(audio).toBeVisible();
    await expect
      .poll(async () => audio.getAttribute('src'), { timeout: 5_000 })
      .toMatch(/^blob:/);

    await expectTrustMeterIdle(page);
    expect(offenders, `unexpected upload-like requests: ${offenders.map((r) => `${r.method()} ${r.url()}`).join(', ')}`).toHaveLength(0);

    await page.getByRole('button', { name: 'Stop microphone' }).click();
    await expect(page.locator('.led')).toHaveClass(/led-off/);
  });
});

test.describe('Screenshot Beautifier', () => {
  test('uploading an image, styling it, and exporting produces a real downloadable image file, with no uploads', async ({ page }) => {
    const offenders = trackUploadLikeRequests(page);

    await page.goto('/screenshot-beautifier/');
    await expectTrustMeterIdle(page);

    // Upload via the Dropzone's underlying file input.
    await page.locator('input[type="file"]').setInputFiles(SCREENSHOT_SOURCE);

    // Once loaded, the canvas stage + side controls should appear.
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    await expect
      .poll(async () => canvas.evaluate((el: HTMLCanvasElement) => el.width > 0 && el.height > 0), { timeout: 10_000 })
      .toBe(true);

    // Pick a background swatch ("Vermilion").
    await page.getByRole('button', { name: 'Vermilion' }).click();
    await expect(page.getByRole('button', { name: 'Vermilion' })).toHaveClass(/active/);

    // Adjust padding, corner radius and shadow sliders (real range inputs).
    const paddingSlider = page.locator('#slider-padding');
    const radiusSlider = page.locator('#slider-corner-radius');
    const shadowSlider = page.locator('#slider-shadow');

    await paddingSlider.focus();
    await paddingSlider.press('End'); // jump to max (200px)
    await expect(page.locator('.slider-field', { hasText: 'Padding' }).locator('.readout')).toHaveText('200px');

    await radiusSlider.focus();
    await radiusSlider.press('End'); // jump to max (48px)
    await expect(page.locator('.slider-field', { hasText: 'Corner radius' }).locator('.readout')).toHaveText('48px');

    await shadowSlider.focus();
    await shadowSlider.press('End'); // jump to max (80px)
    await expect(page.locator('.slider-field', { hasText: 'Shadow' }).locator('.readout')).toHaveText('80px');

    // Export. The button builds a canvas blob and clicks a synthetic <a
    // download> internally — it's the download-triggering element itself
    // here (no separate "Download" link to follow first).
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export image' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('screenshot.png');
    const savePath = path.join(test.info().outputDir, download.suggestedFilename());
    await download.saveAs(savePath);

    const stat = fs.statSync(savePath);
    expect(stat.size).toBeGreaterThan(0);

    // Confirm it's a real, valid PNG by checking the magic bytes.
    const header = Buffer.alloc(8);
    const fd = fs.openSync(savePath, 'r');
    fs.readSync(fd, header, 0, 8, 0);
    fs.closeSync(fd);
    expect(header.toString('hex')).toBe('89504e470d0a1a0a'); // PNG signature

    await expectTrustMeterIdle(page);
    expect(offenders, `unexpected upload-like requests: ${offenders.map((r) => `${r.method()} ${r.url()}`).join(', ')}`).toHaveLength(0);
  });

  test('the exported JPG carries a valid JPEG header', async ({ page }) => {
    const offenders = trackUploadLikeRequests(page);

    await page.goto('/screenshot-beautifier/');
    await page.locator('input[type="file"]').setInputFiles(SCREENSHOT_SOURCE);
    await expect(page.locator('canvas')).toBeVisible();

    await page.getByRole('button', { name: 'JPG', exact: true }).click();
    await expect(page.getByRole('button', { name: 'JPG', exact: true })).toHaveClass(/active/);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export image' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('screenshot.jpg');
    const savePath = path.join(test.info().outputDir, download.suggestedFilename());
    await download.saveAs(savePath);

    const stat = fs.statSync(savePath);
    expect(stat.size).toBeGreaterThan(0);

    const header = Buffer.alloc(3);
    const fd = fs.openSync(savePath, 'r');
    fs.readSync(fd, header, 0, 3, 0);
    fs.closeSync(fd);
    expect(header.toString('hex')).toBe('ffd8ff'); // JPEG SOI marker

    expect(offenders).toHaveLength(0);
  });
});

test.describe('Favicon Generator', () => {
  test('uploading a source image, generating, and downloading produces a zip with the full expected icon set', async ({ page }) => {
    const offenders = trackUploadLikeRequests(page);

    await page.goto('/favicon-generator/');
    await expectTrustMeterIdle(page);

    await page.locator('input[type="file"]').setInputFiles(ICON_SOURCE);

    // Preview strip with the 16/32/48/180px previews should appear.
    await expect(page.locator('.preview-strip')).toBeVisible();
    await expect(page.locator('.preview-cell')).toHaveCount(4);

    await page.getByRole('button', { name: 'Generate icon set' }).click();

    // Wait for generation to finish: the "Download icons.zip" link replaces
    // the progress readout once status flips to 'done'.
    const downloadLink = page.getByRole('link', { name: 'Download icons.zip' });
    await expect(downloadLink).toBeVisible({ timeout: 20_000 });

    // This tool renders a real <a download> link rather than triggering the
    // download straight from the Generate button — click the link itself.
    const downloadPromise = page.waitForEvent('download');
    await downloadLink.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('icons.zip');
    const savePath = path.join(test.info().outputDir, download.suggestedFilename());
    await download.saveAs(savePath);

    const stat = fs.statSync(savePath);
    expect(stat.size).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(fs.readFileSync(savePath));
    const expectedFiles = [
      'favicon.ico',
      'favicon-16x16.png',
      'favicon-32x32.png',
      'favicon-48x48.png',
      'apple-touch-icon.png',
      'android-chrome-192x192.png',
      'android-chrome-512x512.png',
      'maskable-icon-512x512.png',
      'site.webmanifest',
      'head-snippet.html',
    ];
    for (const name of expectedFiles) {
      expect(zip.file(name), `zip is missing ${name}`).not.toBeNull();
      const bytes = await zip.file(name)!.async('uint8array');
      expect(bytes.length, `${name} is empty`).toBeGreaterThan(0);
    }

    // Spot-check that the PNGs are actually real PNGs and the manifest is valid JSON.
    const png32 = await zip.file('favicon-32x32.png')!.async('uint8array');
    expect(Buffer.from(png32.slice(0, 8)).toString('hex')).toBe('89504e470d0a1a0a');

    const manifestText = await zip.file('site.webmanifest')!.async('string');
    const manifest = JSON.parse(manifestText);
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);

    await expectTrustMeterIdle(page);
    expect(offenders, `unexpected upload-like requests: ${offenders.map((r) => `${r.method()} ${r.url()}`).join(', ')}`).toHaveLength(0);
  });
});

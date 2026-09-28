import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * ============================================================================
 * SANDBOX NETWORK LIMITATION — READ BEFORE MODIFYING THESE TESTS
 * ============================================================================
 * This sandbox's egress proxy hard-blocks huggingface.co, unpkg.com, and
 * cdn.jsdelivr.net (confirmed via curl -> explicit HTTP 403 policy denial,
 * and via a real headless Chromium page's fetch() failing outright with no
 * proxy fallback). This is an organization policy block, not a flaky
 * connection, and no retry/proxy-config/alternate-CDN workaround will help.
 *
 * Both tools under test download model/engine assets from those hosts:
 *   - Transcriber fetches Whisper ONNX weights (onnx-community/whisper-*)
 *     from huggingface.co via @huggingface/transformers.
 *   - OCR (tesseract.js) fetches its WASM core + language traineddata from
 *     its default CDN (jsdelivr/unpkg, depending on tesseract.js version).
 *     Unlike Video Compressor's ffmpeg engine and the ONNX tools' WASM
 *     runtime (self-hosted earlier in this project), tesseract.js was left
 *     on its default CDN loading — there is no reliable npm-published
 *     mirror of its language traineddata to self-host instead.
 *
 * Given that, these tests intentionally do NOT attempt to observe a real
 * transcript or real recognized text. What they verify — and CAN fully
 * verify in this sandbox — is that:
 *   1. The upload / model-size / language-picker UI works correctly.
 *   2. Clicking the action button triggers a REAL download attempt to the
 *      expected external host (observed via page.on('request', ...) —
 *      not inferred from a silent no-op).
 *   3. The tool fails fast and shows a clear, user-visible error message
 *      (not an infinite spinner / silent freeze) once that request fails.
 *
 * A human running this suite in a real deployed environment (or a sandbox
 * with CDN/huggingface.co access) still needs to verify real inference
 * output — see the two "REQUIRES NETWORK ACCESS" comments below for exactly
 * what to check.
 * ============================================================================
 */

const SPEECH_WAV = path.resolve(import.meta.dirname, '../fixtures/speech.wav');
const TEXT_IMAGE_PNG = path.resolve(import.meta.dirname, '../fixtures/text-image.png');

test.describe('Transcriber (/transcribe)', () => {
  test('upload + model picker work; model download is attempted and fails gracefully with a clear error', async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (/huggingface\.co|hf\.co|cdn-lfs/i.test(url)) {
        externalRequests.push(url);
      }
    });

    await page.goto('/transcribe/');

    // --- Trust Meter sanity check: no user file bytes uploaded, before any action ---
    const trustKey = page.locator('.trust-meter .tm-key');
    const trustValue = page.locator('.trust-meter .tm-value');
    await expect(trustKey).toHaveText('Uploaded');
    await expect(trustValue).toHaveText('0 bytes');

    // --- 1. Upload UI works ---
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(SPEECH_WAV);

    // Local decode (Web Audio API) should succeed without any network access —
    // it's pure in-browser decoding of the wav fixture.
    await expect(page.locator('.file-name')).toHaveText('speech.wav', { timeout: 15_000 });
    // Waveform + audio player should render once decoding completes.
    await expect(page.locator('canvas.waveform')).toBeVisible();
    await expect(page.locator('audio.player')).toBeVisible();

    // --- Model-size picker (SteppedSlider) works ---
    const modelSlider = page.locator('.model-picker input[type="range"]');
    await expect(modelSlider).toBeVisible();
    await expect(modelSlider).toHaveValue('0'); // defaults to "Fast" (whisper-tiny)
    await modelSlider.fill('1'); // switch to "Accurate" (whisper-base)
    await expect(modelSlider).toHaveValue('1');
    await expect(page.locator('.model-picker .slider-head .readout')).toHaveText('Accurate');

    // --- File upload never left the browser (still true after decode + slider use) ---
    await expect(trustValue).toHaveText('0 bytes');

    // --- 2. Click Transcribe: triggers real model download attempt ---
    const transcribeBtn = page.locator('button.primary-btn', { hasText: 'Transcribe' });
    await transcribeBtn.click();

    // A loading-model progress block should appear (Led + ProgressReadout).
    await expect(page.getByText('Loading model')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Downloading Whisper/)).toBeVisible();

    // --- 3. Assert the tool fails fast with a clear, user-visible error ---
    // (rather than hanging on an infinite spinner). Give it up to 45s for the
    // blocked huggingface.co fetch to actually fail and surface.
    const errorMsg = page.locator('.error-msg').first();
    await expect(errorMsg).toBeVisible({ timeout: 45_000 });
    await expect(errorMsg).toContainText(/could not download the speech model/i);

    // A Retry button should be offered alongside the error — not a dead end.
    await expect(errorMsg.locator('button', { hasText: 'Retry' })).toBeVisible();

    // Confirm a real network attempt to huggingface.co actually happened —
    // the button did not silently no-op.
    expect(
      externalRequests.length,
      `expected at least one request to huggingface.co while loading the model; saw: ${JSON.stringify(externalRequests)}`,
    ).toBeGreaterThan(0);

    // Report (not assert, since TrustMeter's PerformanceObserver only counts
    // xmlhttprequest/fetch initiators with non-zero transferSize — a failed
    // cross-origin fetch may report 0 transferSize, so this could stay at
    // "0 bytes" even though a network attempt was made) what was observed:
    // eslint-disable-next-line no-console
    console.log('[transcribe] Trust Meter value after failed model download:', await trustValue.textContent());

    /*
     * ---- REQUIRES NETWORK ACCESS (huggingface.co) — NOT VERIFIABLE HERE ----
     * With huggingface.co reachable, re-run this flow and additionally assert:
     *   - status progresses to 'transcribing' (Led "Transcribing" visible)
     *     after the model finishes downloading,
     *   - status then reaches 'done' and a `.transcript` block appears,
     *   - the transcript text (`.transcript-body` / `.transcript-text` or the
     *     joined `.chunk` spans) is non-empty and contains most of the words
     *     "quick", "brown", "fox", "jumps", "lazy", "dog", "river", "bank",
     *     "sunny", "morning" — fixture speech.wav was synthesized via
     *     espeak-ng from "The quick brown fox jumps over the lazy dog near
     *     the river bank on a sunny morning."
     *   - the .txt/.srt/.vtt export buttons produce non-empty downloads.
     */
  });
});

test.describe('OCR (/ocr)', () => {
  test('language picker works for multiple languages; upload + extract attempts worker/core download and fails gracefully', async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (/unpkg\.com|cdn\.jsdelivr\.net|jsdelivr\.net|tessdata/i.test(url)) {
        externalRequests.push(url);
      }
    });

    await page.goto('/ocr/');

    // --- Trust Meter sanity check before any action ---
    const trustKey = page.locator('.trust-meter .tm-key');
    const trustValue = page.locator('.trust-meter .tm-value');
    await expect(trustKey).toHaveText('Uploaded');
    await expect(trustValue).toHaveText('0 bytes');

    // --- Language picker UI: multiple languages selectable ---
    const engChip = page.locator('.lang-chip', { hasText: 'English' });
    const malChip = page.locator('.lang-chip', { hasText: 'Malayalam' });
    const hinChip = page.locator('.lang-chip', { hasText: 'Hindi' });

    // English is selected by default.
    await expect(engChip).toHaveClass(/checked/);
    await expect(malChip).not.toHaveClass(/checked/);

    // Selecting a second language adds it (multi-select via checkboxes).
    await malChip.locator('input[type="checkbox"]').check();
    await expect(malChip).toHaveClass(/checked/);
    await expect(engChip).toHaveClass(/checked/); // still selected — additive, not exclusive

    // A third language too.
    await hinChip.locator('input[type="checkbox"]').check();
    await expect(hinChip).toHaveClass(/checked/);

    // Deselecting one leaves the others checked.
    await malChip.locator('input[type="checkbox"]').uncheck();
    await expect(malChip).not.toHaveClass(/checked/);
    await expect(engChip).toHaveClass(/checked/);
    await expect(hinChip).toHaveClass(/checked/);

    // The component enforces "keep at least one language selected": verify
    // deselecting down to a single remaining language cannot go to zero.
    await hinChip.locator('input[type="checkbox"]').uncheck();
    await expect(hinChip).not.toHaveClass(/checked/);
    // Only English left — attempt to uncheck it too; toggleLang() should
    // refuse (list.length === 1 guard), so it must remain checked.
    await engChip.locator('input[type="checkbox"]').uncheck({ force: true });
    await expect(engChip).toHaveClass(/checked/);

    // --- Upload triggers immediately (OCR auto-runs on file select) ---
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TEXT_IMAGE_PNG);

    // File info should reflect the upload right away.
    await expect(page.locator('.file-name')).toHaveText('text-image.png', { timeout: 10_000 });

    // A loading-worker or processing progress block should appear as it
    // attempts to fetch the tesseract.js core/lang data.
    await expect(page.getByText(/Loading language data|Recognizing/)).toBeVisible({ timeout: 10_000 });

    // --- Assert the tool fails fast with a clear, user-visible error ---
    const errorMsg = page.locator('.error-msg').first();
    await expect(errorMsg).toBeVisible({ timeout: 45_000 });
    await expect(errorMsg).toContainText(/could not download the language data|recognition failed/i);

    // A Retry button should be offered.
    await expect(errorMsg.locator('button', { hasText: 'Retry' })).toBeVisible();

    // Confirm a real network attempt to the CDN actually happened.
    // eslint-disable-next-line no-console
    console.log('[ocr] External requests observed:', JSON.stringify(externalRequests));
    expect(
      externalRequests.length,
      `expected at least one request to tesseract.js's CDN while loading core/lang data; saw: ${JSON.stringify(externalRequests)}`,
    ).toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.log('[ocr] Trust Meter value after failed worker download:', await trustValue.textContent());

    /*
     * ---- REQUIRES NETWORK ACCESS (unpkg.com / cdn.jsdelivr.net) — NOT VERIFIABLE HERE ----
     * With the CDN reachable, re-run this flow and additionally assert:
     *   - status progresses through 'loading-worker' -> 'processing' -> 'done',
     *   - a `.result` block with a `#ocr-output` textarea appears,
     *   - the recognized text is non-empty and contains most of "HELLO",
     *     "WORLD", "TESTING", "OCR" — fixture text-image.png reads
     *     "HELLO WORLD" / "TESTING OCR" in large black Arial-style text on
     *     white background.
     *   - "Copy to clipboard" and "Download .txt" produce the expected text.
     */
  });
});

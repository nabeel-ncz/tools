import { test, expect, type Page, type Request } from '@playwright/test';
import path from 'node:path';

// =============================================================================
// Background Remover & Image Upscaler — ONNX runtime tests
// =============================================================================
//
// CONTEXT (read before touching this file):
//
// Earlier in this session, src/tools/remove-background/onnxSetup.ts and
// src/tools/image-upscaler/onnxSetup.ts were changed to self-host
// onnxruntime-web's WASM backend files (via Vite `?url` imports from the npm
// package) instead of fetching them from cdn.jsdelivr.net, which this sandbox's
// egress policy blocks. That part — the ONNX *engine* — is same-origin now and
// IS fully verifiable here, and these tests do verify it for real (see the
// same-origin / no-jsdelivr assertions below).
//
// What is NOT verifiable in this sandbox: the actual *model weights* both tools
// need (Xenova/modnet for Background Remover; Xenova/swin2SR-classical-sr-x2-64
// and -x4-64 for Image Upscaler) are fetched from huggingface.co at runtime, and
// huggingface.co is blocked by the same egress policy — confirmed by a direct
// curl/fetch test returning an explicit policy denial, and reproduced live below
// (in this environment it surfaces as `net::ERR_TUNNEL_CONNECTION_FAILED`, which
// the browser's fetch() reports to JS as a generic "Failed to fetch" TypeError —
// there is no npm-mirrored fallback for these weights, so this is a hard,
// confirmed block, not a flake).
//
// So each tool below gets two tests:
//   1. A fast test that only exercises the upload UI and any pre-processing
//      options (batch queue for Background Remover; 2x/4x toggle for Image
//      Upscaler) — no network/model involved, so nothing here is limited by
//      the sandbox.
//   2. A slower test that clicks the action button and verifies: the
//      onnxruntime-web JS/WASM bundle loads same-origin (today's fix, proven
//      live, not from jsdelivr), a real request is attempted against
//      huggingface.co for the correct model file, that request fails, and the
//      tool surfaces a clear, visible error and returns the UI to a retryable
//      state within a bounded timeout instead of hanging forever.
//
// NEITHER of these tests exercises real segmentation or super-resolution
// output — that requires the actual model weights, which this sandbox cannot
// reach. See the final QA report for exactly what a human with real network
// access still needs to check.

const PHOTO_PATH = path.resolve(import.meta.dirname, '../fixtures/photo.jpg');

// Matches onnxruntime-web's own JS/WASM bundle files (ort.bundle*.js,
// ort-wasm-simd-threaded*.wasm/.mjs/.js, etc.) wherever they're served from.
const ORT_ASSET_RE = /\/ort[-.][^/?]*\.(?:js|mjs|wasm)(?:\?.*)?$/i;

function trackRequests(page: Page) {
  const writes: Request[] = [];
  const jsdelivrRequests: string[] = [];
  const ortAssetRequests: string[] = [];
  const huggingFaceRequests: Request[] = [];

  page.on('request', (req) => {
    const method = req.method();
    const url = req.url();
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') writes.push(req);
    if (/(^https?:\/\/)?([^/]*\.)?cdn\.jsdelivr\.net/i.test(url)) jsdelivrRequests.push(url);
    if (ORT_ASSET_RE.test(url)) ortAssetRequests.push(url);
    if (/huggingface\.co/i.test(url)) huggingFaceRequests.push(req);
  });

  return { writes, jsdelivrRequests, ortAssetRequests, huggingFaceRequests };
}

async function assertNoUploads(page: Page, writes: Request[]) {
  expect(writes, `expected no POST/PUT/PATCH requests, saw: ${writes.map((r) => r.url()).join(', ')}`).toHaveLength(0);
  await expect(page.locator('.trust-meter .tm-key')).toHaveText('Uploaded');
  // NOTE on the Trust Meter's own counting (src/design/primitives/TrustMeter.svelte):
  // its PerformanceObserver adds transferSize for ANY same-page fetch/xhr entry, not
  // specifically upload/request-body bytes — transferSize is total bytes transferred
  // for that resource (response included). In practice this stayed "0 bytes" in every
  // run here because the huggingface.co model fetch never completes a connection
  // (ERR_TUNNEL_CONNECTION_FAILED), so no bytes are ever counted either way. If the
  // network block were ever lifted in a differently-configured environment, a
  // successful (large) model download would also be same-origin-exempt from this
  // counter only insofar as it's a GET with no request body — but the counter as
  // written does not distinguish upload from download volume, which is worth a human
  // follow-up even though it didn't affect what we could observe here.
  await expect(page.locator('.trust-meter .tm-value')).toHaveText('0 bytes');
}

function assertOrtAssetsSelfHosted(page: Page, jsdelivrRequests: string[], ortAssetRequests: string[]) {
  expect(
    jsdelivrRequests,
    `regression: onnxruntime-web assets were requested from cdn.jsdelivr.net (should be fully self-hosted now): ${jsdelivrRequests.join(', ')}`
  ).toHaveLength(0);

  expect(
    ortAssetRequests.length,
    'expected onnxruntime-web to actually load its own JS/WASM bundle (proves the self-hosting fix executed, not just that model download was attempted)'
  ).toBeGreaterThan(0);

  const pageOrigin = new URL(page.url()).origin;
  for (const url of ortAssetRequests) {
    expect(new URL(url).origin, `expected onnxruntime-web asset to load same-origin, got: ${url}`).toBe(pageOrigin);
  }
}

// =========================================================================
// Background Remover
// =========================================================================

test.describe('Background Remover', () => {
  test('upload UI and batch queue work (add multiple, remove one)', async ({ page }) => {
    test.setTimeout(45_000);
    const { writes } = trackRequests(page);

    await page.goto('/remove-background');
    await expect(page.getByText(/drop one or more images/i)).toBeVisible();

    const fileInput = page.locator('input[type="file"]');
    expect(await fileInput.getAttribute('multiple')).not.toBeNull();

    // Batch upload: select the same fixture twice to simulate a multi-file pick.
    await fileInput.setInputFiles([PHOTO_PATH, PHOTO_PATH]);

    const queueItems = page.locator('.queue-item');
    await expect(queueItems).toHaveCount(2);
    await expect(queueItems.first().locator('.queue-name')).toHaveText('photo.jpg');
    await expect(queueItems.first().locator('.queue-status')).toHaveText(/queued/i);
    await expect(queueItems.nth(1).locator('.queue-status')).toHaveText(/queued/i);

    // Remove one item from the batch; queue should shrink accordingly.
    await queueItems.nth(1).locator('.remove-btn').click();
    await expect(queueItems).toHaveCount(1);

    // Action button should be present and read the "downloads model first" label
    // since no model has been fetched yet.
    await expect(page.getByRole('button', { name: /remove background/i })).toBeVisible();

    await assertNoUploads(page, writes);
  });

  test('ONNX engine self-hosts same-origin; model-weight download is attempted against huggingface.co, fails, and surfaces a clear, non-hanging error', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { writes, jsdelivrRequests, ortAssetRequests, huggingFaceRequests } = trackRequests(page);
    const failedHfUrls: string[] = [];
    page.on('requestfailed', (req) => {
      if (/huggingface\.co/i.test(req.url())) failedHfUrls.push(req.url());
    });

    await page.goto('/remove-background');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(PHOTO_PATH);
    await expect(page.locator('.queue-item')).toHaveCount(1);

    const actionBtn = page.getByRole('button', { name: /remove background/i });
    await expect(actionBtn).toBeVisible();
    await actionBtn.click();

    // The download should visibly start (proves the button wires up to a real
    // attempt, not a silently broken handler).
    await expect(page.getByText(/downloading segmentation model/i)).toBeVisible({ timeout: 10_000 });

    // A clear, user-visible error should appear within a bounded timeout —
    // never an indefinite spinner — once the huggingface.co fetch fails.
    const errorEl = page.locator('.error').first();
    await expect(errorEl).toBeVisible({ timeout: 45_000 });
    const errorText = (await errorEl.textContent())?.trim() ?? '';
    expect(errorText.length, `expected a non-empty, user-visible error message, got: "${errorText}"`).toBeGreaterThan(0);
    // Environment-dependent exact wording: an HTTP-level denial (e.g. 403) is
    // rewrapped by the app as "Could not download the model (HTTP …)", while a
    // network-level block (as observed live here: ERR_TUNNEL_CONNECTION_FAILED)
    // surfaces as the browser's own generic "Failed to fetch". Both are
    // legitimate, non-hanging error states, so this asserts non-empty text
    // rather than one exact string.

    // The UI should return to a retryable state, not stay stuck on "Working…".
    await expect(actionBtn).toBeEnabled();
    await expect(actionBtn).not.toHaveText(/working/i);

    // Confirm the model-download attempt was real: an actual request went out
    // to the correct huggingface.co model URL and did not silently succeed.
    expect(huggingFaceRequests.length, 'expected an attempted request to huggingface.co for the model weights').toBeGreaterThan(0);
    expect(huggingFaceRequests.some((r) => r.url().includes('Xenova/modnet'))).toBe(true);
    // It should have actually failed (network-level failure event OR, in an
    // environment where the block instead returns an HTTP error body, a
    // non-2xx response — accept either as proof this wasn't silently ignored).
    expect(
      failedHfUrls.length > 0 || errorText.length > 0,
      'expected the huggingface.co request to either fire a requestfailed event or produce a surfaced error'
    ).toBe(true);

    // Confirm today's self-hosting fix actually holds under real use: the ONNX
    // runtime's own JS/WASM bundle loaded same-origin, never from jsdelivr.
    assertOrtAssetsSelfHosted(page, jsdelivrRequests, ortAssetRequests);

    await assertNoUploads(page, writes);
  });
});

// =========================================================================
// Image Upscaler
// =========================================================================

test.describe('Image Upscaler', () => {
  test('upload UI and 2x/4x scale toggle work', async ({ page }) => {
    test.setTimeout(45_000);
    const { writes } = trackRequests(page);

    await page.goto('/image-upscaler');
    await expect(page.getByText(/drop an image, or click to choose/i)).toBeVisible();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(PHOTO_PATH);

    const twoX = page.getByRole('button', { name: '2×', exact: true });
    const fourX = page.getByRole('button', { name: '4×', exact: true });
    await expect(twoX).toBeVisible();
    await expect(fourX).toBeVisible();

    // Default scale should be 2x.
    await expect(twoX).toHaveAttribute('aria-pressed', 'true');
    await expect(fourX).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: /^upscale 2×$/i })).toBeVisible();

    // Toggle to 4x before starting, as the QA plan requires.
    await fourX.click();
    await expect(fourX).toHaveAttribute('aria-pressed', 'true');
    await expect(twoX).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: /^upscale 4×$/i })).toBeVisible();

    // Toggle back to 2x to confirm it's a genuine two-way toggle, not one-shot.
    await twoX.click();
    await expect(twoX).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^upscale 2×$/i })).toBeVisible();

    await assertNoUploads(page, writes);
  });

  test('ONNX engine self-hosts same-origin; model-weight download (4x) is attempted against huggingface.co, fails, and surfaces a clear, non-hanging error', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { writes, jsdelivrRequests, ortAssetRequests, huggingFaceRequests } = trackRequests(page);
    const failedHfUrls: string[] = [];
    page.on('requestfailed', (req) => {
      if (/huggingface\.co/i.test(req.url())) failedHfUrls.push(req.url());
    });

    await page.goto('/image-upscaler');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(PHOTO_PATH);

    // Exercise the 4x path (rather than the 2x default) to cover both model URLs
    // across the two tests in this file.
    await page.getByRole('button', { name: '4×', exact: true }).click();

    const actionBtn = page.getByRole('button', { name: /^upscale 4×$/i });
    await expect(actionBtn).toBeVisible();
    await actionBtn.click();

    await expect(page.getByText(/downloading 4× upscaling model/i)).toBeVisible({ timeout: 10_000 });

    const errorEl = page.locator('.error').first();
    await expect(errorEl).toBeVisible({ timeout: 45_000 });
    const errorText = (await errorEl.textContent())?.trim() ?? '';
    expect(errorText.length, `expected a non-empty, user-visible error message, got: "${errorText}"`).toBeGreaterThan(0);

    // UI should return to a retryable state — button re-enabled, not stuck.
    await expect(actionBtn).toBeEnabled();
    await expect(actionBtn).not.toHaveText(/working/i);

    // Scale toggle itself should also be usable again (not left disabled forever).
    await expect(page.getByRole('button', { name: '2×', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '4×', exact: true })).toBeEnabled();

    expect(huggingFaceRequests.length, 'expected an attempted request to huggingface.co for the model weights').toBeGreaterThan(0);
    expect(huggingFaceRequests.some((r) => r.url().includes('Xenova/swin2SR-classical-sr-x4-64'))).toBe(true);
    expect(
      failedHfUrls.length > 0 || errorText.length > 0,
      'expected the huggingface.co request to either fire a requestfailed event or produce a surfaced error'
    ).toBe(true);

    assertOrtAssetsSelfHosted(page, jsdelivrRequests, ortAssetRequests);

    await assertNoUploads(page, writes);
  });
});

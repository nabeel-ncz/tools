import { test, expect, type Page, type Request } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
// @ts-expect-error - legacy Node build has no bundled types entry for this subpath
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures');
const fx = (name: string) => path.join(FIXTURES, name);

/** Extract all text (joined with spaces) from every page of a PDF, using the
 * legacy Node build of pdfjs-dist — the real, non-mocked parser the site
 * itself uses in the browser. */
async function extractPdfText(bytes: Buffer | Uint8Array): Promise<string[]> {
  const data = new Uint8Array(bytes);
  const doc = await pdfjsLib.getDocument({ data, disableWorker: true, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it: any) => it.str).join(' '));
  }
  return pages;
}

/** Track every network request made by the page and assert none of them is a
 * body-carrying upload (POST/PUT/PATCH) — these tools must never phone home. */
function trackNoUploads(page: Page) {
  const offenders: Request[] = [];
  page.on('request', (req) => {
    const method = req.method();
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      offenders.push(req);
    }
  });
  return {
    assertNone: () => {
      expect(offenders.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
    },
  };
}

/** Wait for and capture a file download, returning its bytes and suggested name. */
async function captureDownload(page: Page, trigger: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const streamPath = await download.path();
  const bytes = readFileSync(streamPath!);
  return { bytes, suggestedFilename: download.suggestedFilename() };
}

test.describe('PDF Compressor', () => {
  test('compresses an image-heavy scanned PDF and shrinks it', async ({ page }) => {
    const uploads = trackNoUploads(page);
    await page.goto('/pdf-compressor');

    // Trust meter starts at zero bytes uploaded.
    await expect(page.locator('.trust-meter .tm-key')).toHaveText('Uploaded');
    await expect(page.locator('.trust-meter .tm-value')).toHaveText('0 bytes');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(fx('scanned.pdf'));

    // Pick the "Aggressive" compression level.
    await page.getByRole('button', { name: 'Aggressive', exact: true }).click();

    await page.getByRole('button', { name: 'Compress', exact: true }).click();

    const { bytes } = await captureDownload(page, async () => {
      await page.getByRole('button', { name: 'Download', exact: true }).click();
    });

    // Still zero bytes uploaded over the network the whole time.
    await expect(page.locator('.trust-meter .tm-value')).toHaveText('0 bytes');
    uploads.assertNone();

    const inputBytes = readFileSync(fx('scanned.pdf'));
    const inputDoc = await PDFDocument.load(inputBytes);
    const outputDoc = await PDFDocument.load(bytes);

    expect(outputDoc.getPageCount()).toBe(inputDoc.getPageCount());
    expect(bytes.byteLength).toBeLessThan(inputBytes.byteLength);
  });
});

test.describe('Merge PDF', () => {
  test('merges part-a.pdf and part-b.pdf into one 2-page PDF', async ({ page }) => {
    const uploads = trackNoUploads(page);
    await page.goto('/merge-pdf');

    await expect(page.locator('.trust-meter .tm-value')).toHaveText('0 bytes');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([fx('part-a.pdf'), fx('part-b.pdf')]);

    // Both files land in the tray.
    await expect(page.locator('.tray-item')).toHaveCount(2);

    await page.getByRole('button', { name: /Merge 2 PDFs/ }).click();

    const downloadLink = page.getByRole('link', { name: /Download merged\.pdf/ });
    await expect(downloadLink).toBeVisible();

    const { bytes } = await captureDownload(page, async () => {
      await downloadLink.click();
    });

    await expect(page.locator('.trust-meter .tm-value')).toHaveText('0 bytes');
    uploads.assertNone();

    const mergedDoc = await PDFDocument.load(bytes);
    expect(mergedDoc.getPageCount()).toBe(2);

    const pageTexts = await extractPdfText(bytes);
    const allText = pageTexts.join(' ');
    expect(allText).toContain('PART A');
    expect(allText).toContain('PART B');
  });
});

test.describe('Split PDF', () => {
  test('extracts pages 2 and 4 from a 5-page source', async ({ page }) => {
    const uploads = trackNoUploads(page);
    await page.goto('/split-pdf');

    await expect(page.locator('.trust-meter .tm-value')).toHaveText('0 bytes');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(fx('split-source.pdf'));

    // Wait for all 5 thumbnails to render.
    await expect(page.locator('.thumb')).toHaveCount(5);

    // Use the range-input field to select pages 2 and 4.
    const rangeField = page.locator('.range-field input[type="text"]');
    await rangeField.fill('2,4');
    await rangeField.blur();

    // The two matching thumbnails should now be marked selected.
    await expect(page.locator('.thumb.selected')).toHaveCount(2);

    await expect(page.getByRole('button', { name: 'Extract 2 pages', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Extract 2 pages', exact: true }).click();

    const downloadLink = page.getByRole('link', { name: /Download .*-extract\.pdf/ });
    await expect(downloadLink).toBeVisible();

    const { bytes } = await captureDownload(page, async () => {
      await downloadLink.click();
    });

    await expect(page.locator('.trust-meter .tm-value')).toHaveText('0 bytes');
    uploads.assertNone();

    const extractedDoc = await PDFDocument.load(bytes);
    expect(extractedDoc.getPageCount()).toBe(2);

    const pageTexts = await extractPdfText(bytes);
    expect(pageTexts.join(' ')).toContain('PAGE 2');
    expect(pageTexts.join(' ')).toContain('PAGE 4');
    expect(pageTexts.join(' ')).not.toContain('PAGE 1');
    expect(pageTexts.join(' ')).not.toContain('PAGE 3');
    expect(pageTexts.join(' ')).not.toContain('PAGE 5');
  });

  test('splits into one file per page (zip of 5 PDFs)', async ({ page }) => {
    const uploads = trackNoUploads(page);
    await page.goto('/split-pdf');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(fx('split-source.pdf'));
    await expect(page.locator('.thumb')).toHaveCount(5);

    await page.getByRole('button', { name: 'One file per page', exact: true }).click();
    await page.getByRole('button', { name: 'Split all pages', exact: true }).click();

    const downloadLink = page.getByRole('link', { name: /Download .*-pages\.zip/ });
    await expect(downloadLink).toBeVisible({ timeout: 30_000 });

    const { bytes } = await captureDownload(page, async () => {
      await downloadLink.click();
    });

    uploads.assertNone();

    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const fileNames = Object.keys(zip.files);
    expect(fileNames.length).toBe(5);
    for (const name of fileNames) {
      expect(name).toMatch(/-page-\d{3}\.pdf$/);
    }
  });
});

test.describe('Sign & Fill PDF', () => {
  test('types a signature, places it on the page, and exports', async ({ page }) => {
    const uploads = trackNoUploads(page);
    await page.goto('/sign-pdf');

    await expect(page.locator('.trust-meter .tm-value')).toHaveText('0 bytes');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(fx('text.pdf'));

    // The page render + page nav should appear once the PDF is loaded.
    await expect(page.locator('.page-stage')).toBeVisible();
    await expect(page.locator('.page-nav .readout')).toHaveText('Page 1 of 3');

    // Switch to the "Type" signature mode.
    await page.getByRole('button', { name: 'Type', exact: true }).click();
    const typeInput = page.locator('.type-input');
    await typeInput.fill('Ada Lovelace');

    // Add it to the page.
    await page.getByRole('button', { name: 'Add to page', exact: true }).click();

    // A placed element should now be present on the page stage.
    await expect(page.locator('.placed-el')).toHaveCount(1);

    await page.getByRole('button', { name: 'Export signed PDF', exact: true }).click();

    const downloadLink = page.getByRole('link', { name: 'Download signed PDF' });
    await expect(downloadLink).toBeVisible();

    const { bytes } = await captureDownload(page, async () => {
      await downloadLink.click();
    });

    await expect(page.locator('.trust-meter .tm-value')).toHaveText('0 bytes');
    uploads.assertNone();

    const inputBytes = readFileSync(fx('text.pdf'));
    const inputDoc = await PDFDocument.load(inputBytes);
    const outputDoc = await PDFDocument.load(bytes);

    // Same page count, still a valid PDF.
    expect(outputDoc.getPageCount()).toBe(inputDoc.getPageCount());

    // A signature image was embedded onto page 1, so the exported file must
    // be larger than the original (weak but real signal something was drawn).
    expect(bytes.byteLength).toBeGreaterThan(inputBytes.byteLength);

    // Stronger signal: count Image XObjects in the raw PDF bytes. The source
    // fixture has none (it's pure vector text); the signed output must have
    // at least one (the typed-signature PNG drawn onto page 1).
    const countImageXObjects = (buf: Buffer) => (buf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
    expect(countImageXObjects(inputBytes)).toBe(0);
    expect(countImageXObjects(bytes)).toBeGreaterThan(0);
  });
});

test.describe('Redact PDF', () => {
  test('flattens a drawn redaction so the covered text is not extractable, while other pages remain intact', async ({
    page,
  }) => {
    const uploads = trackNoUploads(page);
    await page.goto('/redact');

    await expect(page.locator('.trust-meter .tm-value')).toHaveText('0 bytes');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(fx('text.pdf'));

    const stage = page.locator('.page-stage');
    await expect(stage).toBeVisible();
    await expect(page.locator('.page-nav .readout')).toContainText('Page 1 of 3');

    // Sanity-check the un-redacted source: page 1 does contain the secret
    // string, extracted via the real pdfjs-dist text layer.
    const sourceBytes = readFileSync(fx('text.pdf'));
    const sourcePages = await extractPdfText(sourceBytes);
    expect(sourcePages[0]).toContain('ALPHA-REDACT-ME');
    expect(sourcePages[1]).toContain('BRAVO');
    expect(sourcePages[2]).toContain('CHARLIE');

    // Draw a redaction rectangle over the area of page 1 where the fixture
    // places "ALPHA-REDACT-ME" (drawn at PDF coords x=50,y=680 size 14 on a
    // 612x792pt page, rendered at RENDER_SCALE=1.4 -> canvas px roughly
    // x:70-560, y:(792-694)*1.4=137 to (792-680)*1.4=157). Cover generously.
    const box = await stage.boundingBox();
    if (!box) throw new Error('page-stage has no bounding box');
    const startX = box.x + 40;
    const startY = box.y + 120;
    const endX = box.x + 560;
    const endY = box.y + 170;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 5 });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator('.redact-rect')).toHaveCount(1);

    await expect(
      page.getByRole('button', { name: /Flatten & export \(1 redaction\)/ })
    ).toBeVisible();
    await page.getByRole('button', { name: /Flatten & export \(1 redaction\)/ }).click();

    const downloadLink = page.getByRole('link', { name: 'Download redacted PDF' });
    await expect(downloadLink).toBeVisible({ timeout: 30_000 });

    const { bytes } = await captureDownload(page, async () => {
      await downloadLink.click();
    });

    await expect(page.locator('.trust-meter .tm-value')).toHaveText('0 bytes');
    uploads.assertNone();

    const outputDoc = await PDFDocument.load(bytes);
    expect(outputDoc.getPageCount()).toBe(3);

    const outputPages = await extractPdfText(bytes);

    // The core claim: the redacted page's text is truly gone, not just
    // covered with a box on top of the original vector text.
    expect(outputPages[0]).not.toContain('ALPHA-REDACT-ME');
    expect(outputPages[0]).not.toContain('ALPHA');

    // Untouched pages (2 and 3) were not flattened, so their real vector
    // text layer is still intact and extractable.
    expect(outputPages[1]).toContain('BRAVO');
    expect(outputPages[2]).toContain('CHARLIE');
  });
});

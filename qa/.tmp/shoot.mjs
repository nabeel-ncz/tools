import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:5010';
const OUT = '/home/user/tools/qa/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const pages = [
  ['index', '/'],
  ['video-hub', '/video'],
  ['pdf-hub', '/pdf'],
  ['image-hub', '/image'],
  ['devices-hub', '/devices'],
  ['about', '/about'],
  ['privacy', '/privacy'],
  ['changelog', '/changelog'],
  ['404', '/does-not-exist-page'],
  ['favicon-generator', '/favicon-generator'],
  ['file-drop', '/file-drop'],
  ['image-upscaler', '/image-upscaler'],
  ['merge-pdf', '/merge-pdf'],
  ['mic-test', '/mic-test'],
  ['ocr', '/ocr'],
  ['pdf-compressor', '/pdf-compressor'],
  ['redact', '/redact'],
  ['remove-background', '/remove-background'],
  ['screen-recorder', '/screen-recorder'],
  ['screenshot-beautifier', '/screenshot-beautifier'],
  ['sign-pdf', '/sign-pdf'],
  ['split-pdf', '/split-pdf'],
  ['transcribe', '/transcribe'],
  ['video-compressor', '/video-compressor'],
  ['webcam-test', '/webcam-test'],
];

const widths = [360, 768, 1440];
const themes = ['light', 'dark'];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let count = 0;
for (const [slug, path] of pages) {
  for (const theme of themes) {
    const context = await browser.newContext({
      colorScheme: theme,
    });
    const page = await context.newPage();
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('nabl-theme', t);
      } catch {}
    }, theme);
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 });
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    await page.waitForTimeout(150);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(100);
      const file = `${OUT}/${slug}--${width}--${theme}.png`;
      await page.screenshot({ path: file, fullPage: true });
      count++;
    }
    await context.close();
  }
  console.log('done', slug);
}

console.log('TOTAL SHOTS', count);
await browser.close();

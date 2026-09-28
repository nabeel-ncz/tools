// Generates test fixture files for the Playwright E2E suite. Run once
// (`node tests/fixtures/generate.mjs`) before running tests — fixtures are
// gitignored build artifacts, not checked in.
import sharp from 'sharp';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname);
const FFMPEG = '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';

mkdirSync(DIR, { recursive: true });

function out(name) {
  return path.join(DIR, name);
}

async function svgToPng(svg, outPath) {
  await sharp(Buffer.from(svg)).png().toFile(outPath);
}

// --- 1. text.pdf — 3 pages of real selectable vector text -----------------
async function makeTextPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const words = [
    ['ALPHA', 'This page contains the secret codeword ALPHA-REDACT-ME for redaction testing.'],
    ['BRAVO', 'This page contains the word BRAVO for split/merge page identification.'],
    ['CHARLIE', 'This page contains the word CHARLIE as the final page marker.'],
  ];
  for (const [heading, body] of words) {
    const page = doc.addPage([612, 792]);
    page.drawText(heading, { x: 50, y: 720, size: 28, font, color: rgb(0, 0, 0) });
    page.drawText(body, { x: 50, y: 680, size: 14, font, color: rgb(0, 0, 0) });
  }
  writeFileSync(out('text.pdf'), await doc.save());
}

// --- 2. scanned.pdf — image-only pages (simulates a scan) -----------------
async function makeScannedPdf() {
  const pagePng = out('_scan-page.png');
  await svgToPng(
    `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="1100">
      <rect width="850" height="1100" fill="#f4f1ea"/>
      <text x="60" y="120" font-family="Georgia,serif" font-size="40" fill="#141413">SCANNED DOCUMENT</text>
      <text x="60" y="180" font-family="Georgia,serif" font-size="22" fill="#4a4842">This page is a flattened raster image, like a real scan.</text>
      ${Array.from({ length: 25 }, (_, i) => `<line x1="60" y1="${240 + i * 30}" x2="780" y2="${240 + i * 30}" stroke="#cfc9b8" stroke-width="1"/>`).join('')}
    </svg>`,
    pagePng
  );
  const pngBytes = await sharp(pagePng).png().toBuffer();
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const img = await doc.embedPng(pngBytes);
    const page = doc.addPage([850, 1100]);
    page.drawImage(img, { x: 0, y: 0, width: 850, height: 1100 });
  }
  writeFileSync(out('scanned.pdf'), await doc.save());
  rmSync(pagePng, { force: true });
}

// --- 3. part-a.pdf / part-b.pdf — for merge testing ------------------------
async function makeMergeParts() {
  for (const [name, label] of [
    ['part-a.pdf', 'PART A'],
    ['part-b.pdf', 'PART B'],
  ]) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.drawText(label, { x: 50, y: 720, size: 32, font });
    writeFileSync(out(name), await doc.save());
  }
}

// --- 4. split-source.pdf — 5 numbered pages for split testing -------------
async function makeSplitSource() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 5; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`PAGE ${i}`, { x: 50, y: 720, size: 32, font });
  }
  writeFileSync(out('split-source.pdf'), await doc.save());
}

// --- 5. text-image.png — for OCR ------------------------------------------
async function makeTextImage() {
  await svgToPng(
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300">
      <rect width="900" height="300" fill="#ffffff"/>
      <text x="40" y="100" font-family="Arial, sans-serif" font-size="52" fill="#000000">HELLO WORLD</text>
      <text x="40" y="180" font-family="Arial, sans-serif" font-size="52" fill="#000000">TESTING OCR</text>
    </svg>`,
    out('text-image.png')
  );
}

// --- 6. photo.jpg — synthetic "portrait-like" subject on plain background --
async function makePhoto() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">
    <rect width="640" height="640" fill="#7ec8e3"/>
    <ellipse cx="320" cy="260" rx="130" ry="160" fill="#e8b892"/>
    <ellipse cx="320" cy="520" rx="200" ry="160" fill="#3a5a78"/>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(out('photo.jpg'));
}

// --- 7. icon-source.png — 512x512 square for favicon generator ------------
async function makeIconSource() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" fill="#141413"/>
    <circle cx="256" cy="256" r="160" fill="#e4572e"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out('icon-source.png'));
}

// --- 8. screenshot-source.png — fake app screenshot for beautifier --------
async function makeScreenshotSource() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800">
    <rect width="1280" height="800" fill="#ffffff"/>
    <rect width="1280" height="48" fill="#e5e5e5"/>
    <circle cx="24" cy="24" r="7" fill="#ff5f57"/>
    <circle cx="48" cy="24" r="7" fill="#febc2e"/>
    <circle cx="72" cy="24" r="7" fill="#28c840"/>
    <rect x="100" y="100" width="1080" height="600" fill="#f4f1ea" stroke="#141413"/>
    <text x="140" y="160" font-family="Arial" font-size="32" fill="#141413">Fixture app window</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out('screenshot-source.png'));
}

// --- 9. clip.webm — short silent video clip for video-compressor ----------
async function makeClip() {
  const framesDir = out('_frames');
  mkdirSync(framesDir, { recursive: true });
  const frameCount = 30; // 3s at 10fps
  const framePaths = [];
  for (let i = 0; i < frameCount; i++) {
    const x = Math.round((i / frameCount) * 260);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
      <rect width="320" height="240" fill="#141413"/>
      <rect x="${x}" y="90" width="60" height="60" fill="#e4572e"/>
      <text x="10" y="230" font-family="monospace" font-size="14" fill="#f4f1ea">frame ${i}</text>
    </svg>`;
    const p = path.join(framesDir, `f${String(i).padStart(3, '0')}.jpg`);
    // Only the MJPEG decoder is compiled into this ffmpeg build (no PNG
    // decoder), so frames must be JPEG for ffmpeg to read them back.
    await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(p);
    framePaths.push(p);
  }
  // Only the image2pipe demuxer is compiled in (no glob "%03d.jpg" support),
  // so concatenate the frames and feed them via stdin as an MJPEG stream.
  const concatenated = Buffer.concat(framePaths.map((p) => readFileSync(p)));
  const result = spawnSync(
    FFMPEG,
    ['-y', '-f', 'image2pipe', '-framerate', '10', '-vcodec', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libvpx', out('clip.webm')],
    { input: concatenated, maxBuffer: 1024 * 1024 * 64 }
  );
  if (result.status !== 0) {
    throw new Error('ffmpeg failed: ' + result.stderr.toString());
  }
  rmSync(framesDir, { recursive: true, force: true });
}

// --- 10. speech.wav — real synthesized speech (espeak-ng) -----------------
async function makeSpeech() {
  const dest = out('speech.wav');
  if (!existsSync(dest)) {
    execFileSync('espeak-ng', [
      'The quick brown fox jumps over the lazy dog near the river bank on a sunny morning.',
      '-w', dest,
      '-s', '150',
    ]);
  }
}

await makeTextPdf();
await makeScannedPdf();
await makeMergeParts();
await makeSplitSource();
await makeTextImage();
await makePhoto();
await makeIconSource();
await makeScreenshotSource();
await makeClip();
await makeSpeech();

console.log('Fixtures generated in', DIR);

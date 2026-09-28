import sharp from 'sharp';
import matter from 'gray-matter';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CONTENT_DIR = 'src/content/tools';
const OUT_DIR = 'public/og';
mkdirSync(OUT_DIR, { recursive: true });

const CATEGORY_LABEL = { video: 'Video & Screen', pdf: 'PDF', image: 'Image', devices: 'Devices' };

function escapeXml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      lines.push(current.trim());
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function buildSvg({ serial, title, oneLine, category }) {
  const titleLines = wrapText(title, 20);
  const purposeLines = wrapText(oneLine, 58);

  const titleTspans = titleLines
    .map((line, i) => `<tspan x="80" dy="${i === 0 ? 0 : 64}">${escapeXml(line)}</tspan>`)
    .join('');

  const purposeTspans = purposeLines
    .map((line, i) => `<tspan x="80" dy="${i === 0 ? 0 : 30}">${escapeXml(line)}</tspan>`)
    .join('');

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F4F1EA"/>
  <rect x="1" y="1" width="1198" height="628" fill="none" stroke="#141413" stroke-width="2"/>
  <line x1="80" y1="140" x2="1120" y2="140" stroke="#CFC9B8" stroke-width="1"/>
  <text x="80" y="100" font-family="JetBrains Mono, monospace" font-size="22" letter-spacing="2" fill="#E4572E">NO. ${escapeXml(serial)} &#8212; ${escapeXml((CATEGORY_LABEL[category] ?? category).toUpperCase())}</text>
  <text font-family="Georgia, serif" font-size="58" font-weight="600" fill="#141413" y="230">${titleTspans}</text>
  <text font-family="IBM Plex Sans, sans-serif" font-size="26" fill="#4A4842" y="400">${purposeTspans}</text>
  <text x="80" y="560" font-family="JetBrains Mono, monospace" font-size="20" letter-spacing="1" fill="#141413">NABL TOOLS</text>
  <text x="80" y="588" font-family="IBM Plex Sans, sans-serif" font-size="18" fill="#8A867B">tools.nabl.in &#8212; Nothing leaves your device.</text>
  <circle cx="1080" cy="120" r="6" fill="#E4572E"/>
</svg>`;
}

async function render(slug, data) {
  const svg = buildSvg(data);
  await sharp(Buffer.from(svg)).png().toFile(join(OUT_DIR, `${slug}.png`));
  console.log('wrote', `${OUT_DIR}/${slug}.png`);
}

const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'));
for (const file of files) {
  const raw = readFileSync(join(CONTENT_DIR, file), 'utf8');
  const { data } = matter(raw);
  if (data.status !== 'live') continue;
  await render(data.slug, data);
}

await render('default', {
  serial: '00',
  title: 'NABL Tools',
  oneLine: 'Private, instant browser tools. Nothing leaves your device.',
  category: 'devices',
});

console.log('OG image generation complete.');

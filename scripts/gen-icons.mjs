import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('public/icons', { recursive: true });

const svg = 'public/favicon.svg';

const maskableSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#141413"/>
  <path d="M16 9 L23 16 L16 23 L9 16 Z" fill="none" stroke="#F4F1EA" stroke-width="1.4"/>
  <circle cx="16" cy="16" r="2.2" fill="#E4572E"/>
</svg>
`);

const jobs = [
  { file: svg, size: 16, out: 'public/icons/icon-16.png' },
  { file: svg, size: 32, out: 'public/icons/icon-32.png' },
  { file: svg, size: 180, out: 'public/icons/apple-touch-icon.png' },
  { file: svg, size: 192, out: 'public/icons/icon-192.png' },
  { file: svg, size: 512, out: 'public/icons/icon-512.png' },
  { file: maskableSvg, size: 512, out: 'public/icons/icon-512-maskable.png' },
];

for (const job of jobs) {
  await sharp(job.file).resize(job.size, job.size).png().toFile(job.out);
  console.log('wrote', job.out);
}

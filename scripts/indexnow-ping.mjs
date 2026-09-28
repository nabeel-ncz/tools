#!/usr/bin/env node
/**
 * scripts/indexnow-ping.mjs
 *
 * Notifies Bing (and any other IndexNow-participating search engine) that
 * NABL Tools' pages have changed, per the IndexNow protocol:
 *   https://www.bing.com/indexnow/getstarted
 *   https://www.indexnow.org/documentation
 *
 * It reads the site's own sitemap (dist/sitemap-index.xml and the
 * sitemap(s) it references) to build the full URL list — so the ping is
 * always in sync with whatever the last `npm run build` actually produced,
 * with nothing hand-maintained.
 *
 * IMPORTANT — this cannot be exercised from this sandbox: outbound network
 * access here is restricted to an allowlist of package registries and does
 * not include api.indexnow.org, so a live run will fail with a network/DNS
 * error in this environment. The script is written correctly against the
 * documented API and is meant to run from an environment with real internet
 * access — e.g. a Cloudflare Pages "deploy succeeded" build hook, or a
 * manual run right after a real deploy of the real tools.nabl.in domain.
 * (IndexNow also requires the key file to be reachable at the site root
 * over HTTPS before Bing will accept a submission, so this only works once
 * the site is actually deployed.)
 *
 * Usage:
 *   node scripts/indexnow-ping.mjs [--dist=<path>] [--dry-run]
 *
 * Env:
 *   INDEXNOW_KEY   overrides the key read from the public/<key>.txt file
 *                  (useful if the key is rotated via a secret instead of
 *                  a committed file).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const distArg = args.find((a) => a.startsWith('--dist='));
const DIST = distArg ? path.resolve(process.cwd(), distArg.slice('--dist='.length)) : path.join(ROOT, 'dist');
const DRY_RUN = args.includes('--dry-run');

function loadSiteUrl() {
  const cfg = readFileSync(path.join(ROOT, 'astro.config.mjs'), 'utf8');
  const m = cfg.match(/site:\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('Could not find `site:` in astro.config.mjs');
  return m[1].replace(/\/$/, '');
}

function findIndexNowKey() {
  if (process.env.INDEXNOW_KEY) return process.env.INDEXNOW_KEY.trim();
  const publicDir = path.join(ROOT, 'public');
  const candidates = readdirSync(publicDir).filter((f) => /^[a-f0-9]{32}\.txt$/i.test(f));
  if (candidates.length === 0) {
    throw new Error(
      'No IndexNow key file found in public/ (expected a <32-hex-char>.txt file). ' +
        'Generate one and commit it, or set INDEXNOW_KEY in the environment.'
    );
  }
  if (candidates.length > 1) {
    console.warn(`Warning: multiple IndexNow key files found (${candidates.join(', ')}); using the first.`);
  }
  const file = candidates[0];
  const key = readFileSync(path.join(publicDir, file), 'utf8').trim();
  const keyFromFilename = file.replace(/\.txt$/, '');
  if (key !== keyFromFilename) {
    throw new Error(`Key file public/${file} does not contain the key matching its own filename.`);
  }
  return key;
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());
}

function collectUrlsFromSitemap() {
  const indexPath = path.join(DIST, 'sitemap-index.xml');
  if (!existsSync(indexPath)) {
    throw new Error(`dist/sitemap-index.xml not found at ${indexPath}. Run \`npm run build\` first.`);
  }
  const indexXml = readFileSync(indexPath, 'utf8');
  const childSitemapUrls = extractLocs(indexXml);

  const urls = new Set();
  for (const sitemapUrl of childSitemapUrls) {
    const u = new URL(sitemapUrl);
    const localPath = path.join(DIST, u.pathname);
    if (!existsSync(localPath)) {
      console.warn(`Warning: sitemap-index.xml references ${u.pathname}, but it wasn't found on disk. Skipping.`);
      continue;
    }
    const xml = readFileSync(localPath, 'utf8');
    for (const loc of extractLocs(xml)) urls.add(loc);
  }
  return [...urls];
}

function postJson(hostname, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path: pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 15000,
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: chunks }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const site = loadSiteUrl();
  const host = new URL(site).host;
  const key = findIndexNowKey();
  const keyLocation = `${site}/${key}.txt`;
  const urlList = collectUrlsFromSitemap();

  if (urlList.length === 0) {
    console.error('No URLs found via the sitemap — nothing to submit. Aborting.');
    process.exit(1);
  }

  const payload = {
    host,
    key,
    keyLocation,
    urlList,
  };

  console.log(`IndexNow ping — ${urlList.length} URL(s) for host "${host}"`);
  console.log(`Key location: ${keyLocation}`);
  urlList.forEach((u) => console.log(`  - ${u}`));

  if (DRY_RUN) {
    console.log('\n--dry-run set: not sending the request. Payload above is what would be POSTed to https://api.indexnow.org/indexnow.');
    return;
  }

  console.log('\nPOSTing to https://api.indexnow.org/indexnow ...');
  try {
    const res = await postJson('api.indexnow.org', '/indexnow', payload);
    // IndexNow success responses are 200 (submitted) or 202 (accepted, key not yet verified).
    if (res.statusCode === 200 || res.statusCode === 202) {
      console.log(`Success: HTTP ${res.statusCode}`);
    } else {
      console.error(`Unexpected response: HTTP ${res.statusCode}\n${res.body}`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`IndexNow request failed: ${err.message}`);
    console.error(
      'If this is running in a sandboxed/offline environment, this is expected — ' +
        'see the header comment in this file. Re-run this script from an environment ' +
        'with real internet access after the site is deployed.'
    );
    process.exitCode = 1;
  }
}

main();

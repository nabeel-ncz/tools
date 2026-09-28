#!/usr/bin/env node
/**
 * scripts/seo-audit.mjs
 *
 * A scripted SEO audit over the built `dist/` output of NABL Tools.
 * Parses every dist/**\/index.html (and any dist/*.html) and checks:
 *   1. title / meta description / h1 / canonical / OG + Twitter tags / OG image existence
 *   2. JSON-LD block validity + required @type coverage per page kind
 *   3. sitemap + robots.txt correctness
 *   4. internal link graph (no broken links; homepage/hub/related coverage)
 *   5. (summary only here — see also the Playwright no-JS check) that meaningful
 *      content is present in the raw HTML without JS.
 *
 * Usage:
 *   node scripts/seo-audit.mjs [--dist=<path>]
 *
 * Writes a human-readable report to stdout and structured results to
 * qa/seo-audit.json. Exits non-zero if any check fails, so it can be used
 * as a CI gate.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const distArg = process.argv.find((a) => a.startsWith('--dist='));
const DIST = distArg ? path.resolve(process.cwd(), distArg.slice('--dist='.length)) : path.join(ROOT, 'dist');

// ---------------------------------------------------------------------------
// Small result-collection helpers
// ---------------------------------------------------------------------------

const results = {
  meta: { distDir: DIST, generatedAt: new Date().toISOString() },
  site: null,
  pages: [], // per-page detail
  checks: [], // flat list of {id, category, page, status, message}
  summary: {}, // category -> {pass, fail}
};

function record(category, page, status, message, extra) {
  results.checks.push({ category, page: page ?? null, status, message, ...(extra ? { extra } : {}) });
}

function pass(category, page, message, extra) {
  record(category, page, 'pass', message, extra);
}
function fail(category, page, message, extra) {
  record(category, page, 'fail', message, extra);
}

// ---------------------------------------------------------------------------
// Load project config: site URL, categories, tool content frontmatter
// ---------------------------------------------------------------------------

function loadSiteUrl() {
  const cfg = readFileSync(path.join(ROOT, 'astro.config.mjs'), 'utf8');
  const m = cfg.match(/site:\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('Could not find `site:` in astro.config.mjs');
  return m[1].replace(/\/$/, '');
}

function loadCategories() {
  const src = readFileSync(path.join(ROOT, 'src', 'lib', 'tools.ts'), 'utf8');
  const blockMatch = src.match(/export const CATEGORIES[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
  if (!blockMatch) throw new Error('Could not find CATEGORIES in src/lib/tools.ts');
  const block = blockMatch[1];
  const keys = [...block.matchAll(/^\s{2}(\w+):\s*\{/gm)].map((m) => m[1]);
  const titles = {};
  for (const key of keys) {
    const re = new RegExp(`${key}:\\s*\\{[\\s\\S]*?title:\\s*['"]([^'"]+)['"]`);
    const tm = block.match(re);
    titles[key] = tm ? tm[1] : key;
  }
  return { keys, titles };
}

function loadTools() {
  const dir = path.join(ROOT, 'src', 'content', 'tools');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const tools = files.map((f) => {
    const slug = f.replace(/\.md$/, '');
    const { data } = matter(readFileSync(path.join(dir, f), 'utf8'));
    return { slug, data };
  });
  return tools;
}

const SITE = loadSiteUrl();
const { keys: CATEGORY_KEYS, titles: CATEGORY_TITLES } = loadCategories();
const ALL_TOOLS = loadTools();
const LIVE_TOOLS = ALL_TOOLS.filter((t) => t.data.status === 'live');
const LIVE_SLUGS = new Set(LIVE_TOOLS.map((t) => t.slug));

results.site = { url: SITE, categories: CATEGORY_KEYS, liveToolCount: LIVE_TOOLS.length };

// ---------------------------------------------------------------------------
// Walk dist/**/index.html and dist/*.html
// ---------------------------------------------------------------------------

function walkHtmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error(`dist directory not found at ${DIST}. Run \`npm run build\` first.`);
  process.exit(2);
}

const htmlFiles = walkHtmlFiles(DIST).sort();

// Map a dist file path -> the site-relative URL path it serves at.
function filePathToUrlPath(file) {
  const rel = path.relative(DIST, file).split(path.sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'index.html'.length);
  // bare file, e.g. 404.html
  return '/' + rel;
}

function urlPathToKind(urlPath) {
  const trimmed = urlPath.replace(/^\/|\/$/g, '');
  if (trimmed === '') return { kind: 'home' };
  if (CATEGORY_KEYS.includes(trimmed)) return { kind: 'hub', category: trimmed };
  if (LIVE_SLUGS.has(trimmed)) return { kind: 'tool', slug: trimmed };
  if (trimmed === '404') return { kind: 'error' };
  return { kind: 'other' };
}

// ---------------------------------------------------------------------------
// Tiny attribute-aware tag scanner (no external HTML parser dependency)
// ---------------------------------------------------------------------------

function parseAttrs(attrString) {
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(attrString))) {
    attrs[m[1].toLowerCase()] = m[2];
  }
  return attrs;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#38;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractPage(html) {
  const page = {
    title: null,
    description: null,
    canonical: null,
    h1s: [],
    og: {},
    twitter: {},
    ldjson: [], // { raw, parsed, error }
    links: [], // internal hrefs, deduped
  };

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) page.title = decodeEntities(titleMatch[1].trim());

  for (const m of html.matchAll(/<meta\s+([^>]*?)\/?>/gi)) {
    const attrs = parseAttrs(m[1]);
    if (attrs.name === 'description') page.description = decodeEntities(attrs.content ?? '');
    if (attrs.name === 'twitter:card') page.twitter.card = attrs.content;
    if (attrs.name === 'twitter:title') page.twitter.title = attrs.content;
    if (attrs.name === 'twitter:description') page.twitter.description = attrs.content;
    if (attrs.name === 'twitter:image') page.twitter.image = attrs.content;
    if (attrs.property === 'og:title') page.og.title = attrs.content;
    if (attrs.property === 'og:description') page.og.description = attrs.content;
    if (attrs.property === 'og:image') page.og.image = attrs.content;
    if (attrs.property === 'og:url') page.og.url = attrs.content;
    if (attrs.property === 'og:type') page.og.type = attrs.content;
  }

  for (const m of html.matchAll(/<link\s+([^>]*?)\/?>/gi)) {
    const attrs = parseAttrs(m[1]);
    if (attrs.rel === 'canonical') page.canonical = attrs.href;
  }

  for (const m of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)) {
    const text = decodeEntities(m[1].replace(/<[^>]+>/g, '').trim());
    page.h1s.push(text);
  }

  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    const raw = m[1];
    let parsed = null;
    let error = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      error = e.message;
    }
    page.ldjson.push({ raw, parsed, error });
  }

  const seenLinks = new Set();
  for (const m of html.matchAll(/<a\s+([^>]*?)>/gi)) {
    const attrs = parseAttrs(m[1]);
    const href = attrs.href;
    if (!href) continue;
    if (href.startsWith('//')) continue; // protocol-relative external
    if (!href.startsWith('/')) continue; // external / mailto / tel / anchor-only
    if (href.startsWith('/#')) continue;
    const clean = href.split('#')[0].split('?')[0];
    if (!clean) continue;
    if (!seenLinks.has(clean)) {
      seenLinks.add(clean);
      page.links.push(clean);
    }
  }

  return page;
}

// ---------------------------------------------------------------------------
// Required JSON-LD fields per @type
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = {
  Organization: ['name', 'url'],
  WebSite: ['name', 'url'],
  WebApplication: ['name', 'applicationCategory', 'operatingSystem', 'offers'],
  BreadcrumbList: ['itemListElement'],
  FAQPage: ['mainEntity'],
};

function isNonEmpty(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

// ===========================================================================
// 1 + 2. Per-page checks: meta tags + JSON-LD
// ===========================================================================

const titleMap = new Map(); // title -> [urlPaths]
const descMap = new Map(); // description -> [urlPaths]

for (const file of htmlFiles) {
  const urlPath = filePathToUrlPath(file);
  const { kind, category, slug } = urlPathToKind(urlPath);
  const html = readFileSync(file, 'utf8');
  const page = extractPage(html);
  const label = urlPath;

  results.pages.push({ urlPath, kind, category, slug, file: path.relative(ROOT, file), page });

  if (kind === 'error') {
    // 404.html is not a real indexable page; skip strict per-page SEO checks.
    continue;
  }

  // --- Title ---
  if (!page.title) {
    fail('title', label, 'Missing <title>');
  } else {
    if (page.title.length > 60) {
      fail('title', label, `Title is ${page.title.length} chars (> 60): "${page.title}"`);
    } else {
      pass('title', label, `Title OK (${page.title.length} chars)`);
    }
    const arr = titleMap.get(page.title) ?? [];
    arr.push(label);
    titleMap.set(page.title, arr);
  }

  // --- Description ---
  if (!page.description) {
    fail('description', label, 'Missing <meta name="description">');
  } else {
    if (page.description.length > 155) {
      fail('description', label, `Description is ${page.description.length} chars (> 155)`);
    } else {
      pass('description', label, `Description OK (${page.description.length} chars)`);
    }
    const arr = descMap.get(page.description) ?? [];
    arr.push(label);
    descMap.set(page.description, arr);
  }

  // --- H1 ---
  if (page.h1s.length === 1) {
    pass('h1', label, `Exactly one H1: "${page.h1s[0]}"`);
  } else {
    fail('h1', label, `Expected exactly one H1, found ${page.h1s.length}: ${JSON.stringify(page.h1s)}`);
  }

  // --- Canonical ---
  const expectedCanonical = SITE + urlPath;
  if (!page.canonical) {
    fail('canonical', label, 'Missing <link rel="canonical">');
  } else if (page.canonical !== expectedCanonical) {
    fail('canonical', label, `Canonical "${page.canonical}" does not match self URL "${expectedCanonical}"`);
  } else {
    pass('canonical', label, `Canonical self-references correctly (${page.canonical})`);
  }

  // --- OG tags ---
  const missingOg = ['title', 'description', 'image', 'url'].filter((k) => !isNonEmpty(page.og[k]));
  if (missingOg.length > 0) {
    fail('og-tags', label, `Missing/empty og:${missingOg.join(', og:')}`);
  } else {
    pass('og-tags', label, 'All required og: tags present');
  }

  // --- OG image file existence ---
  if (page.og.image) {
    try {
      const u = new URL(page.og.image);
      const localPath = path.join(DIST, u.pathname);
      if (existsSync(localPath) && statSync(localPath).isFile()) {
        pass('og-image-exists', label, `og:image file exists (${u.pathname})`);
      } else {
        fail('og-image-exists', label, `og:image references missing file: ${u.pathname}`);
      }
    } catch {
      fail('og-image-exists', label, `og:image is not a valid absolute URL: ${page.og.image}`);
    }
  }

  // --- Twitter tags ---
  const missingTw = ['card', 'title', 'description', 'image'].filter((k) => !isNonEmpty(page.twitter[k]));
  if (missingTw.length > 0) {
    fail('twitter-tags', label, `Missing/empty twitter:${missingTw.join(', twitter:')}`);
  } else {
    pass('twitter-tags', label, 'All required twitter: tags present');
  }

  // --- JSON-LD parse validity ---
  let allValid = true;
  for (const [i, block] of page.ldjson.entries()) {
    if (block.error) {
      allValid = false;
      fail('jsonld-parse', label, `ld+json block #${i} failed to parse: ${block.error}`);
    }
  }
  if (page.ldjson.length > 0 && allValid) {
    pass('jsonld-parse', label, `All ${page.ldjson.length} ld+json block(s) parse as valid JSON`);
  }

  // --- JSON-LD required @type coverage per page kind ---
  const types = page.ldjson.filter((b) => b.parsed).map((b) => b.parsed['@type']);
  const byType = Object.fromEntries(page.ldjson.filter((b) => b.parsed).map((b) => [b.parsed['@type'], b.parsed]));

  let expectedTypes = [];
  if (kind === 'home') expectedTypes = ['Organization', 'WebSite'];
  else if (kind === 'hub') expectedTypes = ['BreadcrumbList'];
  else if (kind === 'tool') {
    expectedTypes = ['WebApplication', 'BreadcrumbList'];
    const toolData = ALL_TOOLS.find((t) => t.slug === slug)?.data;
    if (toolData?.faq?.length > 0) expectedTypes.push('FAQPage');
  }

  for (const t of expectedTypes) {
    if (types.includes(t)) {
      pass('jsonld-type', label, `Has required @type ${t}`);
    } else {
      fail('jsonld-type', label, `Missing required @type ${t} (found: ${types.join(', ') || 'none'})`);
    }
  }

  // --- JSON-LD required fields per found type ---
  for (const [type, obj] of Object.entries(byType)) {
    const required = REQUIRED_FIELDS[type];
    if (!required) continue;
    const missing = required.filter((f) => !isNonEmpty(obj[f]));
    if (missing.length > 0) {
      fail('jsonld-fields', label, `${type} missing/empty required field(s): ${missing.join(', ')}`);
    } else {
      pass('jsonld-fields', label, `${type} has all required fields (${required.join(', ')})`);
    }
  }
}

// --- Title / description uniqueness (across all pages found) ---
for (const [title, pages] of titleMap) {
  if (pages.length > 1) {
    fail('title-unique', pages.join(', '), `Title "${title}" is reused across ${pages.length} pages: ${pages.join(', ')}`);
  }
}
if ([...titleMap.values()].every((p) => p.length === 1)) {
  pass('title-unique', null, `All ${titleMap.size} titles are unique`);
}

for (const [desc, pages] of descMap) {
  if (pages.length > 1) {
    fail('description-unique', pages.join(', '), `Description reused across ${pages.length} pages: ${pages.join(', ')}`);
  }
}
if ([...descMap.values()].every((p) => p.length === 1)) {
  pass('description-unique', null, `All ${descMap.size} descriptions are unique`);
}

// ===========================================================================
// 3. Sitemap & robots.txt
// ===========================================================================

const sitemapIndexPath = path.join(DIST, 'sitemap-index.xml');
let sitemapUrls = new Set();

if (!existsSync(sitemapIndexPath)) {
  fail('sitemap', null, 'dist/sitemap-index.xml does not exist');
} else {
  pass('sitemap', null, 'dist/sitemap-index.xml exists');
  const indexXml = readFileSync(sitemapIndexPath, 'utf8');
  const referenced = [...indexXml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  if (referenced.length === 0) {
    fail('sitemap', null, 'sitemap-index.xml references no child sitemaps');
  }
  for (const sitemapUrl of referenced) {
    let u;
    try {
      u = new URL(sitemapUrl);
    } catch {
      fail('sitemap', null, `sitemap-index.xml references invalid URL: ${sitemapUrl}`);
      continue;
    }
    const localPath = path.join(DIST, u.pathname);
    if (!existsSync(localPath)) {
      fail('sitemap', null, `Referenced sitemap file missing on disk: ${u.pathname}`);
      continue;
    }
    pass('sitemap', null, `Referenced sitemap file exists: ${u.pathname}`);
    const xml = readFileSync(localPath, 'utf8');
    for (const m of xml.matchAll(/<loc>(.*?)<\/loc>/g)) sitemapUrls.add(m[1]);
  }
}

// Expected core 21 URLs
const expectedCoreUrls = [
  SITE + '/',
  ...CATEGORY_KEYS.map((k) => `${SITE}/${k}/`),
  ...LIVE_TOOLS.map((t) => `${SITE}/${t.slug}/`),
];

const missingFromSitemap = expectedCoreUrls.filter((u) => !sitemapUrls.has(u));
if (missingFromSitemap.length > 0) {
  fail('sitemap-coverage', null, `Sitemap is missing ${missingFromSitemap.length} expected URL(s): ${missingFromSitemap.join(', ')}`);
} else {
  pass('sitemap-coverage', null, `All ${expectedCoreUrls.length} expected core page URLs are present in the sitemap`);
}

// Extras: any sitemap URL that doesn't resolve to a real dist file (i.e. would 404)
const existingUrlPaths = new Set(results.pages.filter((p) => p.kind !== 'error').map((p) => p.urlPath));
const extrasPointingTo404 = [...sitemapUrls].filter((u) => {
  const p = u.replace(SITE, '');
  return !existingUrlPaths.has(p);
});
if (extrasPointingTo404.length > 0) {
  fail('sitemap-no-404s', null, `Sitemap URL(s) that do not resolve to a real built page: ${extrasPointingTo404.join(', ')}`);
} else {
  pass('sitemap-no-404s', null, `All ${sitemapUrls.size} sitemap URLs resolve to a real built page`);
}

const robotsPath = path.join(DIST, 'robots.txt');
if (!existsSync(robotsPath)) {
  fail('robots', null, 'dist/robots.txt does not exist');
} else {
  const robots = readFileSync(robotsPath, 'utf8');
  pass('robots', null, 'dist/robots.txt exists');

  if (/Disallow:\s*\/\s*$/im.test(robots)) {
    fail('robots', null, 'robots.txt has a blanket "Disallow: /"');
  } else {
    pass('robots', null, 'robots.txt does not blanket-disallow crawling');
  }
  if (/User-agent:\s*\*/i.test(robots) && /Allow:\s*\//i.test(robots)) {
    pass('robots', null, 'robots.txt has "User-agent: *" with "Allow: /"');
  } else {
    fail('robots', null, 'robots.txt missing a "User-agent: *" + "Allow: /" pair');
  }
  const sitemapLineMatch = robots.match(/Sitemap:\s*(\S+)/i);
  if (!sitemapLineMatch) {
    fail('robots', null, 'robots.txt has no Sitemap: directive');
  } else if (sitemapLineMatch[1] !== `${SITE}/sitemap-index.xml`) {
    fail('robots', null, `robots.txt Sitemap directive "${sitemapLineMatch[1]}" does not match expected "${SITE}/sitemap-index.xml"`);
  } else {
    pass('robots', null, `robots.txt Sitemap directive correctly points to ${sitemapLineMatch[1]}`);
  }
}

// ===========================================================================
// 4. Internal link graph — no broken links, expected coverage
// ===========================================================================

function resolveUrlPathToFile(urlPath) {
  const clean = urlPath.split('#')[0].split('?')[0];
  if (clean === '/' || clean === '') return path.join(DIST, 'index.html');
  const trimmed = clean.replace(/\/$/, '');
  const withIndex = path.join(DIST, trimmed, 'index.html');
  const bare = path.join(DIST, `${trimmed}.html`);
  if (existsSync(withIndex)) return withIndex;
  if (existsSync(bare)) return bare;
  return null;
}

const linkPageIndex = new Map(results.pages.map((p) => [p.urlPath, p]));

let brokenLinkCount = 0;
let totalLinkCount = 0;
for (const p of results.pages) {
  if (p.kind === 'error') continue;
  for (const href of p.page.links) {
    totalLinkCount++;
    const target = resolveUrlPathToFile(href);
    if (!target) {
      brokenLinkCount++;
      fail('broken-link', p.urlPath, `Link to "${href}" does not resolve to any file in dist/`);
    }
  }
}
if (brokenLinkCount === 0) {
  pass('broken-link', null, `All ${totalLinkCount} internal links across ${results.pages.length} pages resolve to real files`);
}

// Homepage -> all 4 hubs + all 16 tools
const home = linkPageIndex.get('/');
if (home) {
  const hrefSet = new Set(home.page.links.map((h) => h.replace(/\/$/, '') || '/'));
  const missingHubs = CATEGORY_KEYS.filter((k) => !hrefSet.has(`/${k}`));
  const missingTools = LIVE_TOOLS.filter((t) => !hrefSet.has(`/${t.slug}`));
  if (missingHubs.length === 0) {
    pass('homepage-links-hubs', '/', `Homepage links to all ${CATEGORY_KEYS.length} category hubs`);
  } else {
    fail('homepage-links-hubs', '/', `Homepage is missing links to hub(s): ${missingHubs.join(', ')}`);
  }
  if (missingTools.length === 0) {
    pass('homepage-links-tools', '/', `Homepage links to all ${LIVE_TOOLS.length} live tools`);
  } else {
    fail('homepage-links-tools', '/', `Homepage is missing links to tool(s): ${missingTools.map((t) => t.slug).join(', ')}`);
  }
} else {
  fail('homepage-links-hubs', '/', 'Homepage (/) not found among built pages');
}

// Each hub -> its own category's tools
for (const category of CATEGORY_KEYS) {
  const hubPage = linkPageIndex.get(`/${category}/`) ?? linkPageIndex.get(`/${category}`);
  const categoryTools = LIVE_TOOLS.filter((t) => t.data.category === category);
  if (!hubPage) {
    fail('hub-links-tools', `/${category}`, `Hub page for "${category}" not found among built pages`);
    continue;
  }
  const hrefSet = new Set(hubPage.page.links.map((h) => h.replace(/\/$/, '') || '/'));
  const missing = categoryTools.filter((t) => !hrefSet.has(`/${t.slug}`));
  if (missing.length === 0) {
    pass('hub-links-tools', `/${category}`, `Hub links to all ${categoryTools.length} of its category's tools`);
  } else {
    fail('hub-links-tools', `/${category}`, `Hub is missing links to: ${missing.map((t) => t.slug).join(', ')}`);
  }
}

// Each tool page's "Related instruments" links vs its `related` frontmatter
for (const tool of LIVE_TOOLS) {
  const toolPage = linkPageIndex.get(`/${tool.slug}/`) ?? linkPageIndex.get(`/${tool.slug}`);
  if (!toolPage) {
    fail('related-links', `/${tool.slug}`, `Tool page not found among built pages`);
    continue;
  }
  const hrefSet = new Set(toolPage.page.links.map((h) => h.replace(/\/$/, '') || '/'));
  const related = tool.data.related ?? [];
  const staleRefs = related.filter((slug) => !LIVE_SLUGS.has(slug));
  const missingLinks = related.filter((slug) => LIVE_SLUGS.has(slug) && !hrefSet.has(`/${slug}`));

  if (staleRefs.length > 0) {
    fail(
      'related-frontmatter',
      `/${tool.slug}`,
      `\`related\` frontmatter references non-existent/non-live tool slug(s): ${staleRefs.join(', ')}`
    );
  }
  if (missingLinks.length === 0 && staleRefs.length === 0) {
    pass('related-links', `/${tool.slug}`, `All ${related.length} related tool(s) are correctly linked`);
  } else if (missingLinks.length > 0) {
    fail('related-links', `/${tool.slug}`, `Related tool(s) in frontmatter not linked on page: ${missingLinks.join(', ')}`);
  }
}

// ===========================================================================
// 5. Content visible without JavaScript (raw-HTML check on representative pages)
// ===========================================================================

function stripTagsAndScripts(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const representativePages = [
  { urlPath: '/', label: 'homepage', markers: (text) => ['Nothing leaves your device'] },
  {
    urlPath: '/pdf-compressor/',
    label: 'tool page (pdf-compressor)',
    markers: () => {
      const data = ALL_TOOLS.find((t) => t.slug === 'pdf-compressor')?.data;
      const marks = [data.title, data.oneLine, data.steps[0]];
      if (data.faq?.length > 0) marks.push(data.faq[0].q);
      return marks;
    },
  },
  {
    urlPath: '/pdf/',
    label: 'hub page (pdf)',
    markers: () => [CATEGORY_TITLES.pdf, 'Compress, merge, split'],
  },
];

for (const rp of representativePages) {
  const file = resolveUrlPathToFile(rp.urlPath);
  if (!file) {
    fail('no-js-content', rp.label, `Could not find built file for ${rp.urlPath}`);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  const text = stripTagsAndScripts(html);
  const markers = rp.markers(text);
  const missing = markers.filter((mk) => !text.includes(mk));
  if (missing.length === 0 && text.length > 300) {
    pass(
      'no-js-content',
      rp.label,
      `Raw HTML contains ${text.length} chars of visible text incl. all ${markers.length} expected content marker(s)`
    );
  } else {
    fail(
      'no-js-content',
      rp.label,
      `Raw HTML missing expected content marker(s): ${JSON.stringify(missing)} (visible text length: ${text.length})`
    );
  }
}

// ===========================================================================
// Summarize + write output
// ===========================================================================

const byCategory = {};
for (const c of results.checks) {
  byCategory[c.category] ??= { pass: 0, fail: 0 };
  byCategory[c.category][c.status]++;
}
results.summary = byCategory;

const totalPass = results.checks.filter((c) => c.status === 'pass').length;
const totalFail = results.checks.filter((c) => c.status === 'fail').length;

mkdirSync(path.join(ROOT, 'qa'), { recursive: true });
writeFileSync(path.join(ROOT, 'qa', 'seo-audit.json'), JSON.stringify(results, null, 2));

// --- Human-readable report ---
console.log(`\nNABL Tools — SEO Audit`);
console.log(`dist: ${DIST}`);
console.log(`site: ${SITE}`);
console.log(`pages parsed: ${results.pages.length} (expected core pages: ${expectedCoreUrls.length})\n`);

console.log('Category'.padEnd(24) + 'Pass'.padEnd(8) + 'Fail');
console.log('-'.repeat(40));
for (const [cat, counts] of Object.entries(byCategory).sort()) {
  console.log(cat.padEnd(24) + String(counts.pass).padEnd(8) + String(counts.fail));
}
console.log('-'.repeat(40));
console.log('TOTAL'.padEnd(24) + String(totalPass).padEnd(8) + String(totalFail));

const failures = results.checks.filter((c) => c.status === 'fail');
if (failures.length > 0) {
  console.log(`\n${failures.length} failing check(s):\n`);
  for (const f of failures) {
    console.log(`  [${f.category}]${f.page ? ` ${f.page}` : ''} — ${f.message}`);
  }
} else {
  console.log('\nNo failing checks.');
}

console.log(`\nFull structured results written to qa/seo-audit.json\n`);

process.exit(totalFail > 0 ? 1 : 0);

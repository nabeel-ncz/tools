# IndexNow

NABL Tools supports [IndexNow](https://www.indexnow.org/) so that Bing (and
any other participating search engine — Bing, Yandex, Seznam.cz, Naver, and
others that share the same index) can be told the instant a page changes,
instead of waiting for its own crawler to notice.

## The key

- **Key file:** `public/0196303edef14bdc80953cae3c6ed66e.txt`
- **Key:** `0196303edef14bdc80953cae3c6ed66e`
- **Key location (once deployed):** `https://tools.nabl.in/0196303edef14bdc80953cae3c6ed66e.txt`

Per the IndexNow spec, the key file must live at the site root, be named
`<key>.txt`, and contain nothing but the key itself — which is exactly what
`public/<key>.txt` builds to, since everything under `public/` is copied
verbatim to the root of `dist/`.

If the key is ever rotated (e.g. it leaked, or you just want a fresh one):

1. Generate a new key: `node -e "console.log(require('crypto').randomUUID().replace(/-/g,''))"`.
2. Delete the old `public/<old-key>.txt` and add `public/<new-key>.txt`
   containing the new key.
3. Update this doc.
4. Either set `INDEXNOW_KEY` in the environment before running the ping
   script, or just let it auto-discover the new key file (see below).

## Running the ping

```sh
npm run indexnow
# or directly:
node scripts/indexnow-ping.mjs
```

What it does:

1. Reads `dist/sitemap-index.xml` and the sitemap(s) it references to build
   the full, current list of page URLs — so it's always in sync with
   whatever the last `npm run build` actually produced. Nothing is
   hand-maintained.
2. Reads the IndexNow key from the `public/<key>.txt` file (or from the
   `INDEXNOW_KEY` env var, if set).
3. POSTs `{ host, key, keyLocation, urlList }` to
   `https://api.indexnow.org/indexnow`, per the
   [IndexNow API spec](https://www.indexnow.org/documentation).

Pass `--dry-run` to print the exact payload without sending it, and
`--dist=<path>` to point at a different build output directory.

## When to run it

Run it after every deploy that changes page content or adds/removes pages
— i.e. right after a real, live deploy, not as part of the local build.
IndexNow submissions only matter once `tools.nabl.in` is actually the live
domain the key file is reachable at.

The natural place to wire this in is a **Cloudflare Pages deploy hook**
("on deploy succeeded", after the build is live): call `npm run indexnow`
as a post-deploy step, or hit the Cloudflare Pages webhook and forward to a
tiny job that runs the script. Do not run it as part of `npm run build` or
`prebuild` — the build runs in this sandbox (and in any CI without real
domain access) long before there's a live site for `keyLocation` to
resolve to, and a submission before the key file is publicly reachable
will just be rejected by Bing.

## Why this couldn't be verified live in this session

This sandbox's outbound network access is allowlisted to package registries
(npm, pypi, etc.) and does not include `api.indexnow.org`. A real run here
returns an HTTP 403 from the sandbox's egress proxy before it ever reaches
Bing — confirmed while writing this script. The script's request-building
and response-handling logic round-trips correctly against that proxy
response, but the actual submission has not been (and cannot be) verified
against the real IndexNow API from here. Re-run `npm run indexnow` from an
environment with real internet access (a Cloudflare Pages build hook, or a
developer's own machine) after the site is deployed with the real
`tools.nabl.in` domain, and confirm it returns HTTP 200 or 202.

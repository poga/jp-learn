# Content-hashed esbuild build system

**Date:** 2026-06-28
**Status:** Approved (design)

## Goal

Every cacheable asset gets a content-hashed filename, so a changed file is a
new URL. The browser and service worker can never serve a stale copy under the
same name. This permanently fixes the iOS stale-cache problem (a footer change
not appearing on mobile because the old service worker kept serving cached
assets) and removes the manual "clear cache" workaround.

## Current state

- Zero-dependency static PWA. No `package.json`; tooling is node built-ins only.
- Two entry pages that share some assets:
  - `index.html` — kana table; loads `style.css`, `kana.js`, `script.js`,
    `pwa.js`, `manifest.webmanifest`, `apple-touch-icon.png`.
  - `anki.html` — practice; loads `style.css`, `kana.js`, `fsrs.js`, `stats.js`,
    `anki.js`, `pwa.js`, `manifest.webmanifest`, `apple-touch-icon.png`.
- JS files are plain globals concatenated into one scope (a test asserts this).
  Pure modules (`kana.js`, `fsrs.js`, `stats.js`) also carry a CommonJS
  `module.exports` block for node tests.
- `build-sw.js` derives the precache list from page references and stamps a
  content-hash cache version; `sw.js` is cache-first for all GETs.
- Caddy serves the repo directory directly; deploy = run the SW build in place.

## Architecture

### Directory layout

```
src/    index.html, anki.html, *.js, style.css, manifest.webmanifest, icons   (editable source)
dist/   built output, content-hashed — what Caddy serves   (gitignored)
build.js, test.js, package.json   (repo root)
```

### Module refactor (required by esbuild bundling)

Convert concatenated globals to ES modules:

- `kana.js` → `export { KANA, LAYOUT, matchRomaji }`
- `fsrs.js` → `export` each function/constant; drop the `module.exports` block
- `stats.js` → `export` each function; drop the `module.exports` block
- `script.js` (index entry) → `import { KANA, LAYOUT, matchRomaji } from './kana.js'`
- `anki.js` (anki entry) → `import` from `./kana.js`, `./fsrs.js`, `./stats.js`
- `pwa.js` → imported by both page entries

esbuild entry points: `script.js` (bundles kana + pwa) and `anki.js` (bundles
kana + fsrs + stats + pwa); `style.css` is a third entry. Pages load bundles via
`<script type="module">`.

### Build pipeline (`build.js`)

esbuild handles code; `build.js` wires the static assets esbuild does not see
(HTML, icons, manifest):

1. esbuild bundle + minify the JS entries and CSS into `dist/` with
   `entryNames: '[name]-[hash]'` and `metafile: true`. Produces e.g.
   `script-A1B2.js`, `anki-C3D4.js`, `style-E5F6.css`.
2. Hash-copy icons into `dist/` (e.g. `icon-512-XXXX.png`); record an
   original → hashed name map.
3. Generate `manifest-YYYY.webmanifest` in `dist/` with hashed icon references.
4. Template the two HTML pages: rewrite each `src`/`href` from its logical
   source name to the hashed output name (reuse the existing
   `(?:href|src)="..."` parsing), write to `dist/`.
5. Generate `sw.js` (stable name) precaching every hashed output plus the two
   HTML pages and `./`.

`--watch` rebuilds `dist/` on source change for local development.

### Cache strategy

Folds in the previously planned network-first-for-navigations change:

- Hashed assets (all JS, CSS, icons, manifest): immutable → **cache-first**,
  served from cache forever.
- HTML entry points (`index.html`, `anki.html`, `/`): stable URLs →
  **network-first**, falling back to cache when offline.
- A new build changes the hashed names inside `sw.js`, so a new service worker
  installs, precaches the new set, `skipWaiting()` + `clients.claim()`, and
  deletes the old cache — an atomic update with no stale assets.

### Tooling

- New `package.json` with `esbuild` as the only devDependency. Scripts:
  - `build` → `node build.js`
  - `dev` → `node build.js --watch`
  - `test` → `node test.js`
- `.gitignore` adds `dist/` and `node_modules/`.
- Minify on; sourcemaps off (easy toggle later).

## Testing

No mocks — tests run the real pipeline and assert observable outputs.

- Pure tests (`fsrs`, `stats`, `kana`): convert `require` to `import` from
  `src/`; assertions unchanged.
- Remove the "shared global scope" test — obsolete once real modules exist.
- Add a build smoke test: run the real build into a temp dir and assert:
  - every page references only files that exist in `dist/`;
  - each hashed filename matches its content hash;
  - `sw.js` precaches exactly the built assets plus the two pages and `./`;
  - HTML references are the hashed names (no bare `style.css` / `script.js`).
- Adapt existing PWA tests (manifest valid, both pages register the worker) to
  read from `dist/` after a build.

## Deploy model change

Caddy must serve `dist/` instead of the repo root. New deploy = `npm run build`.
The Caddyfile root change is manual (outside this repo); exact steps will be
called out at hand-off. The deploy memory note will be updated after merge.

## Out of scope

No TypeScript, no UI framework, no CSS preprocessing, no route or behavior
changes. Only delivery and caching change.

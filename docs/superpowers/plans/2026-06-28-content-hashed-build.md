# Content-hashed esbuild build system — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle and content-hash every asset with esbuild so a changed file is a new URL, permanently fixing stale service-worker caches on iOS.

**Architecture:** Editable sources move to `src/`. A node `build.js` runs esbuild to bundle + minify + hash the two page entries and the stylesheet, hashes icons, rewrites the manifest and HTML to the hashed names, and generates a service worker (network-first for navigations, cache-first for immutable hashed assets) into `dist/`. Caddy serves `dist/`.

**Tech Stack:** node (built-ins) + esbuild (only devDependency), ES modules, node's built-in test runner.

## Global Constraints

- **Zero runtime dependencies.** `esbuild` is the only devDependency.
- **ES modules everywhere.** `package.json` has `"type": "module"`; no CommonJS `require`/`module.exports` in source, build, or tests.
- **Layout:** sources in `src/`, build output in `dist/` (gitignored). Caddy serves `dist/`.
- **Behavior unchanged.** No route, UI, or logic changes — only delivery and caching.
- **No mocks in tests.** Run the real build; assert on real `dist/` output.
- **Comments:** never exceed one line (80 chars); keep minimal.
- **Commits:** end each commit message with the standard `Co-Authored-By:` and `Claude-Session:` trailers used in this repo.

---

### Task 1: Scaffold tooling, relocate to `src/`, convert pure modules to ESM

**Files:**
- Create: `package.json`, `.gitignore`
- Move (git mv → `src/`): `index.html`, `anki.html`, `kana.js`, `fsrs.js`, `stats.js`, `script.js`, `anki.js`, `pwa.js`, `style.css`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `icon.svg`, `apple-touch-icon.png`
- Delete (git rm): `build-sw.js`, `sw.js`
- Modify: `src/kana.js` (tail), `src/fsrs.js` (tail), `src/stats.js` (tail)
- Modify: `test.js` (imports + drop build/PWA/global-scope tests)

**Interfaces:**
- Produces: ESM named exports — `src/kana.js` → `{ KANA, LAYOUT, matchRomaji }`; `src/stats.js` → `{ newStats, recordReview, recordNew, newOn, reviewsOn, currentStreak, bestStreak, retention }`; `src/fsrs.js` → `{ newCard, schedule, previewIntervals, retrievability, nextInterval, fuzzRange, applyFuzz, initStability, initDifficulty, nextDifficulty, successStability, lapseStability, sameDayStability, DAY_MS, MIN_MS, LEARN_STEPS, RELEARN_STEPS }`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "jp-learn",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.js",
    "dev": "node build.js --watch",
    "test": "node test.js"
  },
  "devDependencies": {
    "esbuild": "^0.24.0"
  }
}
```

- [ ] **Step 2: Install esbuild**

Run: `npm install`
Expected: `node_modules/` created, `esbuild` present, `package-lock.json` written.

- [ ] **Step 3: Create `.gitignore`**

```
node_modules
dist
.DS_Store
```

(Replaces the existing `.gitignore` contents; keep `.DS_Store` if it was there.)

- [ ] **Step 4: Relocate sources into `src/`**

Run:
```bash
mkdir -p src
git mv index.html anki.html kana.js fsrs.js stats.js script.js anki.js \
  pwa.js style.css manifest.webmanifest \
  icon-192.png icon-512.png icon.svg apple-touch-icon.png src/
git rm build-sw.js sw.js
```
Expected: all listed files now under `src/`; `build-sw.js` and `sw.js` removed.

- [ ] **Step 5: Convert `src/kana.js` to ESM**

Replace the trailing block:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KANA, LAYOUT, matchRomaji };
}
```
with:
```js
export { KANA, LAYOUT, matchRomaji };
```

- [ ] **Step 6: Convert `src/fsrs.js` to ESM**

Replace the trailing block:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { newCard, schedule, previewIntervals,
    retrievability, nextInterval, fuzzRange, applyFuzz,
    initStability, initDifficulty, nextDifficulty,
    successStability, lapseStability, sameDayStability,
    DAY_MS, MIN_MS, LEARN_STEPS, RELEARN_STEPS };
}
```
with:
```js
export { newCard, schedule, previewIntervals,
  retrievability, nextInterval, fuzzRange, applyFuzz,
  initStability, initDifficulty, nextDifficulty,
  successStability, lapseStability, sameDayStability,
  DAY_MS, MIN_MS, LEARN_STEPS, RELEARN_STEPS };
```

- [ ] **Step 7: Convert `src/stats.js` to ESM**

Replace the trailing block:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { newStats, recordReview, recordNew, newOn, reviewsOn,
    currentStreak, bestStreak, retention };
}
```
with:
```js
export { newStats, recordReview, recordNew, newOn, reviewsOn,
  currentStreak, bestStreak, retention };
```

- [ ] **Step 8: Convert `test.js` head to ESM and remove now-invalid tests**

Replace lines 1-9 (the `require` block) with:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { matchRomaji, KANA, LAYOUT } from './src/kana.js';
import { newStats, recordReview, recordNew, newOn, reviewsOn, currentStreak,
  bestStreak, retention } from './src/stats.js';
import * as fsrs from './src/fsrs.js';
```
Then delete these tests entirely (they depend on the deleted `build-sw.js` or on global concatenation):
- `pwa: sw.js is up to date with the build (rerun node build-sw.js)`
- `pwa: every asset the pages reference is precached for offline`
- `pwa: manifest is valid and points only at files that exist`
- `pwa: both pages register the worker and link the manifest`
- `browser scripts share one global scope without redeclaration`

Also delete the helper functions `swAssets()` and `pageAssets()` and the comment above them. Leave all `matchRomaji`, `KANA`/`LAYOUT`, `stats`, and `fsrs` tests intact.

- [ ] **Step 9: Run tests to verify the pure-module suite passes under ESM**

Run: `node test.js`
Expected: PASS, ~30 tests, 0 failures (all fsrs/stats/kana tests green; no build/PWA tests present).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: src/ layout, ESM pure modules, esbuild scaffold"
```

---

### Task 2: Convert browser glue to ESM imports; single module entry per page

**Files:**
- Modify: `src/script.js` (prepend imports), `src/anki.js` (prepend imports)
- Modify: `src/index.html` (script tags), `src/anki.html` (script tags)
- Modify: `test.js` (add esbuild bundle smoke test)

**Interfaces:**
- Consumes: ESM exports from Task 1 (`kana`, `fsrs`, `stats`).
- Produces: two esbuild entry points — `src/script.js` (pulls in `kana`, `pwa`) and `src/anki.js` (pulls in `kana`, `fsrs`, `stats`, `pwa`).

- [ ] **Step 1: Write the failing bundle test**

Append to `test.js`:
```js
import esbuild from 'esbuild';

test('build: page entries bundle cleanly as ESM', async () => {
  const r = await esbuild.build({
    entryPoints: ['./src/script.js', './src/anki.js'],
    bundle: true, write: false, format: 'esm', logLevel: 'silent',
  });
  assert.equal(r.errors.length, 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test.js`
Expected: FAIL — the entries still reference globals (`KANA`, `schedule`, …) with no imports, so esbuild reports unresolved references / build errors.

- [ ] **Step 3: Add imports to `src/script.js`**

Prepend to the top of the file (before `const byId = …`):
```js
import { KANA, LAYOUT, matchRomaji } from './kana.js';
import './pwa.js';
```

- [ ] **Step 4: Add imports to `src/anki.js`**

Prepend at the very top of the file (above the existing lead comment):
```js
import { KANA } from './kana.js';
import { newCard, schedule, previewIntervals, DAY_MS } from './fsrs.js';
import { newStats, recordReview, recordNew, newOn, reviewsOn,
  currentStreak, bestStreak, retention } from './stats.js';
import './pwa.js';
```

- [ ] **Step 5: Update `src/index.html` to a single module entry**

Remove `<script src="pwa.js" defer></script>` from `<head>`. Replace the two body scripts:
```html
  <script src="kana.js"></script>
  <script src="script.js"></script>
```
with:
```html
  <script type="module" src="script.js"></script>
```

- [ ] **Step 6: Update `src/anki.html` to a single module entry**

Remove `<script src="pwa.js" defer></script>` from `<head>`. Replace the four body scripts:
```html
  <script src="kana.js"></script>
  <script src="fsrs.js"></script>
  <script src="stats.js"></script>
  <script src="anki.js"></script>
```
with:
```html
  <script type="module" src="anki.js"></script>
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node test.js`
Expected: PASS — bundle test green, all pure-module tests still green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: ESM imports in page glue, one module entry per page"
```

---

### Task 3: `build.js` core — bundle + hash JS/CSS, icons, manifest, HTML

**Files:**
- Create: `build.js`
- Modify: `test.js` (add build smoke tests + `before` hook)

**Interfaces:**
- Consumes: the esbuild entry points from Task 2; icon files and `manifest.webmanifest` in `src/`.
- Produces: `export async function build()` → returns `{ refMap }` and writes hashed assets, rewritten manifest, and templated HTML into `dist/`. `refMap` maps each logical source name (`script.js`, `anki.js`, `style.css`, icon names, `manifest.webmanifest`) to its hashed output basename.

- [ ] **Step 1: Write `build.js` (core pipeline, no service worker yet)**

```js
// Build: bundle+hash JS/CSS via esbuild, hash icons, rewrite manifest + HTML.
// Output to dist/. Service worker is added in a later step.
import esbuild from 'esbuild';
import crypto from 'node:crypto';
import path from 'node:path';
import {
  rmSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';

const ROOT = import.meta.dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const PAGES = ['index.html', 'anki.html'];
const ICONS = ['icon-192.png', 'icon-512.png', 'icon.svg', 'apple-touch-icon.png'];

const hash8 = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);

// "name.ext" -> "name-<hash>.ext"
function hashedName(name, buf) {
  const ext = path.extname(name);
  return `${name.slice(0, -ext.length)}-${hash8(buf)}${ext}`;
}

function cleanDist() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
}

// Bundle + minify the page entries and stylesheet, content-hashed.
async function bundleCode() {
  const { metafile } = await esbuild.build({
    entryPoints: [
      path.join(SRC, 'script.js'),
      path.join(SRC, 'anki.js'),
      path.join(SRC, 'style.css'),
    ],
    bundle: true, minify: true, format: 'esm',
    entryNames: '[name]-[hash]', outdir: DIST, metafile: true,
  });
  const map = {};
  for (const [out, meta] of Object.entries(metafile.outputs))
    if (meta.entryPoint) map[path.basename(meta.entryPoint)] = path.basename(out);
  return map;
}

// Copy each icon under a content-hashed name; return {original: hashed}.
function hashIcons() {
  const map = {};
  for (const ic of ICONS) {
    const buf = readFileSync(path.join(SRC, ic));
    const out = hashedName(ic, buf);
    writeFileSync(path.join(DIST, out), buf);
    map[ic] = out;
  }
  return map;
}

// Rewrite manifest icon srcs to hashed names; emit it content-hashed too.
function buildManifest(iconMap) {
  const mani = JSON.parse(readFileSync(path.join(SRC, 'manifest.webmanifest'), 'utf8'));
  for (const ic of mani.icons || []) if (iconMap[ic.src]) ic.src = iconMap[ic.src];
  const json = JSON.stringify(mani, null, 2);
  const out = hashedName('manifest.webmanifest', Buffer.from(json));
  writeFileSync(path.join(DIST, out), json);
  return out;
}

// Rewrite every local href/src in a page to its hashed output name.
function buildHtml(page, refMap) {
  const html = readFileSync(path.join(SRC, page), 'utf8')
    .replace(/(href|src)="([^"]+)"/g, (m, attr, url) =>
      refMap[url] ? `${attr}="${refMap[url]}"` : m);
  writeFileSync(path.join(DIST, page), html);
}

export async function build() {
  cleanDist();
  const codeMap = await bundleCode();
  const iconMap = hashIcons();
  const manifest = buildManifest(iconMap);
  const refMap = { ...codeMap, ...iconMap, 'manifest.webmanifest': manifest };
  for (const page of PAGES) buildHtml(page, refMap);
  return { refMap };
}
```

- [ ] **Step 2: Write the failing build smoke tests**

In `test.js`, add the import and a one-time build, then the assertions:
```js
import crypto from 'node:crypto';
import { before } from 'node:test';
import { build } from './build.js';

const DIST = path.join(import.meta.dirname, 'dist');
before(async () => { await build(); });

function pageRefs(page) {
  const html = fs.readFileSync(path.join(DIST, page), 'utf8');
  return [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map(m => m[1]).filter(u => !/^(https?:|data:|#|mailto:)/.test(u));
}

test('build: pages reference only files present in dist', () => {
  for (const page of ['index.html', 'anki.html'])
    for (const ref of pageRefs(page))
      assert.ok(fs.existsSync(path.join(DIST, ref)), `${page} -> missing ${ref}`);
});

test('build: asset refs are content-hashed and match their content', () => {
  for (const page of ['index.html', 'anki.html'])
    for (const ref of pageRefs(page)) {
      if (ref.endsWith('.html')) continue; // page-to-page nav links stay plain
      const m = ref.match(/-([0-9a-f]{8})\.(js|css|png|svg|webmanifest)$/);
      assert.ok(m, `${ref} is not hashed`);
      const buf = fs.readFileSync(path.join(DIST, ref));
      assert.equal(m[1], crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8));
    }
});

test('build: no bare asset names leak into HTML', () => {
  const bare = ['style.css', 'script.js', 'anki.js', 'manifest.webmanifest',
    'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon.svg'];
  for (const page of ['index.html', 'anki.html']) {
    const html = fs.readFileSync(path.join(DIST, page), 'utf8');
    for (const b of bare) assert.ok(!html.includes(`"${b}"`), `${page} still references ${b}`);
  }
});

test('build: manifest is valid and its icons exist in dist', () => {
  const ref = pageRefs('anki.html').find(r => r.endsWith('.webmanifest'));
  const mani = JSON.parse(fs.readFileSync(path.join(DIST, ref), 'utf8'));
  for (const ic of mani.icons) assert.ok(fs.existsSync(path.join(DIST, ic.src)), `missing ${ic.src}`);
});
```

- [ ] **Step 3: Run the tests to verify the build tests pass**

Run: `node test.js`
Expected: PASS — `dist/` is built; pages reference only hashed files that exist; hashes match; no bare names; manifest valid. (No SW test yet.)

- [ ] **Step 4: Sanity-check the build output by hand**

Run: `node build.js && ls dist`
Expected: `index.html`, `anki.html`, `script-*.js`, `anki-*.js`, `style-*.css`, `icon-192-*.png`, `icon-512-*.png`, `icon-*.svg`, `apple-touch-icon-*.png`, `manifest-*.webmanifest`. (`node build.js` prints nothing yet — CLI output is added in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: build.js bundles + content-hashes assets into dist/"
```

---

### Task 4: `build.js` service worker + CLI/watch

**Files:**
- Modify: `build.js` (add `buildSW`, wire into `build()`, add CLI + `--watch`)
- Modify: `test.js` (add SW + page-shell tests)

**Interfaces:**
- Consumes: a fully populated `dist/` from Task 3's `build()`.
- Produces: `dist/sw.js` (stable name) precaching every hashed asset plus the two HTML pages and `./`; network-first for navigations, cache-first otherwise. `build()` now also returns `{ version, assets }`.

- [ ] **Step 1: Add `buildSW` to `build.js`**

Add `readdirSync` to the `node:fs` import:
```js
import {
  rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync,
} from 'node:fs';
```
Add the function (after `buildHtml`):
```js
// Precache every built file plus the pages and root; cache key tracks content.
function buildSW() {
  const assets = readdirSync(DIST).filter(f => f !== 'sw.js');
  const list = ['./', ...assets].sort();
  const version = 'anki-' + hash8(Buffer.from(list.join('|')));
  const sw = `// GENERATED by build.js — do not edit. Run: node build.js
const CACHE = ${JSON.stringify(version)};
const ASSETS = ${JSON.stringify(list, null, 2)};

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// network-first for navigations (fresh HTML); cache-first for hashed assets
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); return res; })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
    return res;
  })));
});
`;
  writeFileSync(path.join(DIST, 'sw.js'), sw);
  return { version, assets: list };
}
```

- [ ] **Step 2: Wire `buildSW` into `build()` and add a CLI entry**

Change the end of `build()` from:
```js
  for (const page of PAGES) buildHtml(page, refMap);
  return { refMap };
}
```
to:
```js
  for (const page of PAGES) buildHtml(page, refMap);
  const sw = buildSW();
  return { refMap, ...sw };
}

import { realpathSync } from 'node:fs';
const isMain = process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename;
if (isMain) {
  await build();
  console.log('built dist/ ·', readdirSync(DIST).length, 'files');
  if (process.argv.includes('--watch')) {
    const { watch } = await import('node:fs');
    let timer = null;
    watch(SRC, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => build().then(() => console.log('rebuilt')), 100);
    });
    console.log('watching src/ …');
  }
}
```

- [ ] **Step 3: Write the failing SW tests**

Append to `test.js`:
```js
function swAssets() {
  const src = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  return JSON.parse(src.match(/const ASSETS = (\[[\s\S]*?\]);/)[1]);
}

test('build: sw precaches exactly the dist files plus root', () => {
  const onDisk = fs.readdirSync(DIST).filter(f => f !== 'sw.js');
  const precached = new Set(swAssets());
  assert.ok(precached.has('./'));
  for (const f of onDisk) assert.ok(precached.has(f), `sw missing ${f}`);
  for (const a of precached) if (a !== './')
    assert.ok(onDisk.includes(a), `sw lists absent ${a}`);
});

test('build: sw is network-first for navigations, cache-first otherwise', () => {
  const src = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  assert.match(src, /req\.mode === 'navigate'/);
  assert.match(src, /caches\.match\('\.\/'\)/);
  assert.match(src, /caches\.match\(req\)\.then\(hit => hit \|\| fetch\(req\)/);
});

test('build: both pages link manifest, apple-touch-icon, and a module script', () => {
  for (const page of ['index.html', 'anki.html']) {
    const html = fs.readFileSync(path.join(DIST, page), 'utf8');
    assert.match(html, /rel="manifest"/);
    assert.match(html, /rel="apple-touch-icon"/);
    assert.match(html, /<script type="module"/);
  }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node test.js`
Expected: PASS — all tests green (pure modules, bundle, build, SW, page-shell).

- [ ] **Step 5: Verify the CLI prints and watch flag parses**

Run: `node build.js`
Expected: prints `built dist/ · <N> files`, `dist/sw.js` exists.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: generate network-first service worker; build CLI + watch"
```

---

### Task 5: Docs, end-to-end verification, deploy hand-off

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the complete build from Tasks 1-4.

- [ ] **Step 1: Update `README.md`**

Replace the build/deploy section so it documents the new flow. Include exactly:
```markdown
## Build

`npm install` once, then:

- `npm run build` — bundle + content-hash everything into `dist/`
- `npm run dev` — rebuild `dist/` on every change in `src/`
- `npm test` — run the test suite

Sources live in `src/`; `dist/` is generated and gitignored.

## Deploy

Point Caddy's site root at `dist/` (not the repo root), then run
`npm run build` in place. Hashed filenames make every asset immutable, so
updates land without clearing caches; HTML is served network-first.
```
Remove any prior reference to `node build-sw.js` or serving the repo root directly.

- [ ] **Step 2: Full clean build + test**

Run: `rm -rf dist && npm run build && npm test`
Expected: build prints the file count; `node test.js` PASS, 0 failures.

- [ ] **Step 3: Verify offline shell integrity**

Run: `node -e "import('node:fs').then(fs=>{const a=JSON.parse(fs.readFileSync('dist/sw.js','utf8').match(/ASSETS = (\[[\s\S]*?\]);/)[1]);console.log(a)})"`
Expected: array lists `./`, both `.html` pages, and every hashed asset — confirming the offline precache is complete.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: README build/dev/test + dist/ deploy flow"
```

- [ ] **Step 5: Deploy hand-off (manual, outside the repo)**

After merge to `main`:
1. Run `npm run build` in the primary checkout so `dist/` is populated.
2. Change the Caddyfile site root to the repo's `dist/` directory and reload Caddy.
3. Update the deploy memory note to reflect `npm run build` + `dist/` as the new deploy.

This step is manual because it touches the Caddyfile and the user's memory, both outside this repo.

---

## Self-Review

**Spec coverage:**
- Goal (content-hash everything, fix iOS stale cache) → Tasks 3-4 (hashing + SW). ✓
- Layout `src/`→`dist/` → Task 1 (move) + Task 3 (`dist/` output). ✓
- Module refactor to ESM → Task 1 (pure) + Task 2 (glue). ✓
- Build pipeline (esbuild bundle/minify/hash, icons, manifest, HTML, SW) → Tasks 3-4. ✓
- Cache strategy (network-first navigations, cache-first hashed) → Task 4 `buildSW`. ✓
- Tooling (`package.json`, esbuild dep, scripts, `.gitignore`, minify, watch) → Task 1 + Task 4. ✓
- Tests (port pure to ESM, drop global-scope, add build smoke, adapt PWA) → Tasks 1-4. ✓
- Deploy model change (Caddy → `dist/`) → Task 5. ✓
- Out of scope (no TS/framework/route changes) → respected throughout. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output.

**Type consistency:** `build()` returns `{ refMap }` in Task 3, extended to `{ refMap, version, assets }` in Task 4 (additive). `refMap` keys are logical source names; `swAssets()`/`pageRefs()` helper names are used consistently in tests. `hash8`/`hashedName` defined once in `build.js`; tests recompute the hash inline with the same algorithm (sha256, 8 hex). Exported names in Task 1 match the imports in Task 2 and `test.js`.

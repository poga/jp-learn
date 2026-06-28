# 五十音 アンキ

A small Japanese-kana learning PWA. Two pages, plain browser JS, no framework:

- `index.html` — the gojūon (五十音) reference grid (`script.js` + `kana.js`).
- `anki.html` — an Anki-style review session backed by an FSRS scheduler
  (`anki.js` + `fsrs.js` + `stats.js`).

`kana.js` and `fsrs.js` are pure (no DOM, no `localStorage`) and dual-export for
Node tests. There is no bundler — pages run straight from the filesystem.

## Develop

Open `index.html` / `anki.html` via `file://`, or browse the served copy (below).

## Test

```sh
node test.js
```

`node:test` suite over the pure modules plus PWA invariants (manifest valid,
every referenced asset precached, `sw.js` in sync with the build).

## Service worker

`sw.js` is generated — never edit it by hand. It derives the precache list from
what the pages reference and stamps a content-hash version:

```sh
node build-sw.js
```

Run it after changing any precached asset (icons, css, js, html), so clients
drop the stale cache. The pwa tests fail if `sw.js` is out of date.

## Deploy

Served live on this machine by **Caddy** (config `/opt/homebrew/etc/Caddyfile`),
`file_server` rooted directly at this repo, mounted at
`https://dev.taileea02.ts.net/jp/`. The working tree **is** the live site.

To deploy a change:

1. Save the files in place.
2. `node build-sw.js` (bump the SW precache version).
3. Done — no upload, no Caddy restart.

`git push` is backup only; GitHub Pages is not configured.

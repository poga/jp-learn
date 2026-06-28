# 五十音 アンキ

A small Japanese-kana learning PWA. Two pages, plain browser JS, no framework:

- `index.html` — the gojūon (五十音) reference grid (`script.js` + `kana.js`).
- `anki.html` — an Anki-style review session backed by an FSRS scheduler
  (`anki.js` + `fsrs.js` + `stats.js`).

`kana.js` and `fsrs.js` are pure (no DOM, no `localStorage`) and dual-export for
Node tests.

## Build

`npm install` once, then:

- `npm run build` — bundle + content-hash everything into `dist/`
- `npm run dev` — rebuild `dist/` on every change in `src/`
- `npm test` — run the test suite

Sources live in `src/`; `dist/` is generated and gitignored.

## Test

```sh
npm test
```

`node:test` suite over the pure modules plus PWA invariants (manifest valid,
every referenced asset precached, `sw.js` in sync with the build).

## Deploy

Point Caddy's site root at `dist/` (not the repo root), then run
`npm run build` in place. Hashed filenames make every asset immutable, so
updates land without clearing caches; HTML is served network-first.

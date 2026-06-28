// Build: bundle+hash JS/CSS via esbuild, hash icons, rewrite manifest + HTML.
// Output to dist/. Service worker is added in a later step.
import esbuild from 'esbuild';
import crypto from 'node:crypto';
import path from 'node:path';
import {
  rmSync, mkdirSync, readFileSync, writeFileSync, renameSync,
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

// Bundle + minify the page entries and stylesheet, then sha256-hash the outputs.
async function bundleCode() {
  const { metafile } = await esbuild.build({
    entryPoints: [
      path.join(SRC, 'script.js'),
      path.join(SRC, 'anki.js'),
      path.join(SRC, 'style.css'),
    ],
    bundle: true, minify: true, format: 'esm',
    outdir: DIST, metafile: true,
  });
  const map = {};
  for (const [out, meta] of Object.entries(metafile.outputs)) {
    if (!meta.entryPoint) continue;
    const buf = readFileSync(out);
    const hashed = hashedName(path.basename(out), buf);
    renameSync(out, path.join(DIST, hashed));
    map[path.basename(meta.entryPoint)] = hashed;
  }
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

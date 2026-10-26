#!/usr/bin/env node
/**
 * Turns the static web export (`dist/`, built with EXPO_PUBLIC_DATA=mock and
 * EXPO_PUBLIC_MAP_OFFLINE=1) into a claude.ai Artifact bundle in `dist-artifact/`:
 *
 * - `index.html` keeps only head/body content (the Artifact host adds its own
 *   doctype/html/head/body skeleton), with a theme-aware body background so the
 *   viewer never shows through, and the boot shim from `artifact-boot.js`.
 * - The viewer serves the page from an unknown sub-path, so every root-absolute URL
 *   (`/_expo/...`, `/assets/...`, `/favicon.ico`) is made relative; the boot shim's
 *   `<base href>` keeps them resolving after Expo Router changes the URL.
 *
 * The Artifact CSP blocks every external host (no tiles, glyphs or sprites), so the export
 * MUST use the offline map canvas (EXPO_PUBLIC_MAP_OFFLINE=1); otherwise the map would try to
 * fetch the OpenFreeMap style and stay on its fallback with console errors.
 *
 * Usage: npm run export:artifact            (does both steps below)
 *        EXPO_PUBLIC_DATA=mock EXPO_PUBLIC_MAP_OFFLINE=1 npx expo export --platform web --output-dir dist
 *        node scripts/build-artifact.mjs
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'dist');
const out = join(root, 'dist-artifact');

const html = readFileSync(join(src, 'index.html'), 'utf8');
const pick = (re, label) => {
  const m = html.match(re);
  if (!m) throw new Error(`build-artifact: ${label} not found in dist/index.html`);
  return m[1];
};
const head = pick(/<head>([\s\S]*?)<\/head>/i, '<head>')
  // The host skeleton provides charset + viewport (with viewport-fit=cover).
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta httpEquiv[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<title>[\s\S]*?<\/title>\s*/i, '');
const body = pick(/<body>([\s\S]*?)<\/body>/i, '<body>').replace(/<!--[\s\S]*?-->\s*/g, '');

// Background tokens mirror @st/ui `background` (ink50 / ink950) for light/dark (docs/design-system.md §2.1).
const page = `<title>Sport Talent</title>
<style>
  :root { --st-bg: #F6F7FB; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --st-bg: #0A0B12; color-scheme: dark; } }
  :root[data-theme="dark"] { --st-bg: #0A0B12; color-scheme: dark; }
  html, body { background: var(--st-bg); }
</style>
<script>
${readFileSync(join(root, 'scripts', 'artifact-boot.js'), 'utf8').trim()}
</script>
${head.trim()}
${body.trim()}
`;

// The Artifact service reserves top-level names starting with "_", so `_expo/`
// is published as `st-static/` and every reference to it is rewritten.
const RESERVED = '_expo';
const RENAMED = 'st-static';
const rewrite = (text) =>
  text
    .split(`/${RESERVED}/`).join(`/${RENAMED}/`)
    .split(`"/${RENAMED}/`).join(`"${RENAMED}/`)
    .split(`'/${RENAMED}/`).join(`'${RENAMED}/`)
    .split('"/assets/__node_modules').join('"assets/__node_modules')
    .split('href="/favicon.ico"').join('href="favicon.ico"');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, {
  recursive: true,
  filter: (p) => !(p === join(src, 'index.html') || p === join(src, RESERVED) || p.startsWith(join(src, RESERVED) + '/')),
});
cpSync(join(src, RESERVED), join(out, RENAMED), { recursive: true });
// Expo's async-chunk loader resolves chunk paths against the site origin (not <base>), but passes
// absolute http(s) URLs through untouched; prefix each chunk path with the runtime base instead.
const absolutizeChunks = (text) => text.replace(/"(\d+)":"st-static\//g, '"$1":globalThis.__ST_BASE__+"st-static/');
for (const file of walk(join(out, RENAMED))) {
  if (/\.(js|mjs)$/.test(file)) writeFileSync(file, absolutizeChunks(rewrite(readFileSync(file, 'utf8'))));
  else if (file.endsWith('.css')) writeFileSync(file, rewrite(readFileSync(file, 'utf8')));
}
writeFileSync(join(out, 'index.html'), rewrite(page));
console.log(`build-artifact: wrote ${out}`);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

#!/usr/bin/env node
/**
 * Turns the static web export (`dist/`, built with EXPO_PUBLIC_DATA=mock) into a
 * claude.ai Artifact bundle in `dist-artifact/`:
 *
 * - `index.html` keeps only head/body content (the Artifact host adds its own
 *   doctype/html/head/body skeleton), with a theme-aware body background so the
 *   viewer never shows through, and a boot shim that routes `/index.html` to `/`.
 * - Every other exported file is copied unchanged. Artifacts get their own
 *   origin, so the bundle's absolute `/_expo/...` and `/assets/...` URLs resolve.
 *
 * Usage: EXPO_PUBLIC_DATA=mock npx expo export --platform web --output-dir dist
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
  // Expo Router reads location.pathname; the Artifact may load the page as /index.html.
  try { if (/\\/index\\.html$/.test(location.pathname)) history.replaceState(null, '', '/'); } catch (e) {}
</script>
${head.trim()}
${body.trim()}
`;

// The Artifact service reserves top-level names starting with "_", so `_expo/`
// is published as `st-static/` and every reference to it is rewritten.
const RESERVED = '_expo';
const RENAMED = 'st-static';
const rewrite = (text) => text.split(`/${RESERVED}/`).join(`/${RENAMED}/`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, {
  recursive: true,
  filter: (p) => !(p === join(src, 'index.html') || p === join(src, RESERVED) || p.startsWith(join(src, RESERVED) + '/')),
});
cpSync(join(src, RESERVED), join(out, RENAMED), { recursive: true });
for (const file of walk(join(out, RENAMED))) {
  if (/\.(js|css|mjs)$/.test(file)) writeFileSync(file, rewrite(readFileSync(file, 'utf8')));
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

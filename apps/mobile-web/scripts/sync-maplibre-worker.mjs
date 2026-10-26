// Copies maplibre-gl's module worker into public/ so the static web export serves it at
// /maplibre-gl-worker.mjs (maplibre-gl v6 loads its worker by URL; see src/platform/map/Map.web.tsx).
// Run after upgrading maplibre-gl:  node scripts/sync-maplibre-worker.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require.resolve('maplibre-gl/package.json');
const src = join(dirname(pkg), 'dist', 'maplibre-gl-worker.mjs');
const out = join(here, '..', 'public');
mkdirSync(out, { recursive: true });
// Vendored, minified third-party code: excluded from lint by the header below.
writeFileSync(join(out, 'maplibre-gl-worker.mjs'), `/* eslint-disable */\n${readFileSync(src, 'utf8')}`);
console.log(`maplibre-gl worker ${require('maplibre-gl/package.json').version} → public/maplibre-gl-worker.mjs`);

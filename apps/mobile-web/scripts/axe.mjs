#!/usr/bin/env node
/**
 * axe-core accessibility pass over the main screens (design QA). Serves the static mock export
 * (`dist/`, EXPO_PUBLIC_DATA=mock), signs in as the demo host and walks the app in-app (a reload
 * would reset the in-memory data), running @axe-core/playwright (WCAG 2.0/2.1/2.2 A + AA) on
 * each screen in each locale/scheme.
 *
 *   node scripts/axe.mjs                       # en,he × light,dark; fails on critical/serious
 *   node scripts/axe.mjs --locale he --scheme dark --all   # also list moderate/minor
 *
 * Exit code 1 when any critical or serious violation is found.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const LOCALES = (flag('locale') ?? 'en,he').split(',');
const SCHEMES = (flag('scheme') ?? 'light,dark').split(',');
const PORT = Number(flag('port') ?? 4329);
const ALL = argv.includes('--all');
const DIST = resolve(root, flag('dist') ?? 'dist');
const LOCALE_TAG = { en: 'en-US', he: 'he-IL', ar: 'ar-EG', de: 'de-DE' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };

function serve(dir, port) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const safe = normalize(url).replace(/^(\.\.[/\\])+/, '');
    let file = [join(dir, safe), join(dir, `${safe}.html`), join(dir, safe, 'index.html')].find((p) => p.startsWith(dir) && existsSync(p) && statSync(p).isFile());
    if (!file) file = join(dir, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

const tid = (p, id) => p.getByTestId(id).filter({ visible: true }).first();
const wait = (p, ms = 600) => p.waitForTimeout(ms);
async function back(p) {
  await p.getByTestId('nav.back').filter({ visible: true }).last().click();
  await wait(p, 400);
}
async function toTabs(p) {
  for (let i = 0; i < 6 && !(await tid(p, 'nav.tab.profile').isVisible().catch(() => false)); i++) await back(p);
}

/** Screen name → how to get there from wherever the previous step left off. */
const STEPS = [
  ['phone', async (p) => { await p.goto('/'); await tid(p, 'auth.phone.input').waitFor({ timeout: 20000 }); }],
  ['otp', async (p) => {
    await p.getByTestId('auth.phone.country').selectOption('IL').catch(() => undefined);
    await p.getByTestId('auth.phone.input').fill('500000002');
    await tid(p, 'auth.phone.submit').click();
    await tid(p, 'auth.otp.input').waitFor();
  }],
  ['map', async (p) => {
    await p.getByTestId('auth.otp.input').fill('123456');
    await p.waitForURL(/\/map$/, { timeout: 15000 });
    await wait(p, 800);
    if (await tid(p, 'map.location.notNow').isVisible().catch(() => false)) await tid(p, 'map.location.notNow').click();
    await wait(p, 1200);
  }],
  ['map-list', async (p) => { await tid(p, 'map.list.toggle').click(); await wait(p); }],
  ['game', async (p) => { await tid(p, 'map.card.g-tlv-1').click(); await tid(p, 'game.title').waitFor(); await wait(p); }],
  ['chat', async (p) => { await tid(p, 'game.chat').click(); await tid(p, 'chat.list').waitFor(); await wait(p); }],
  ['teams', async (p) => { await back(p); await tid(p, 'game.host.teams').click(); await tid(p, 'teams.balance').waitFor(); }],
  ['host-qr', async (p) => { await back(p); await tid(p, 'game.host.qr').click(); await tid(p, 'checkin.qr.show').waitFor(); await wait(p); }],
  ['checkin', async (p) => {
    await back(p);
    await p.evaluate(() => { window.history.pushState({}, '', '/game/g-tlv-1/checkin'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await tid(p, 'screen.game.checkin').waitFor(); await wait(p);
  }],
  ['games', async (p) => { await toTabs(p); await tid(p, 'nav.tab.games').click(); await tid(p, 'screen.games').waitFor(); await wait(p); }],
  ['inbox', async (p) => { await tid(p, 'nav.tab.inbox').click(); await tid(p, 'screen.inbox').waitFor(); await wait(p); }],
  ['profile', async (p) => { await tid(p, 'nav.tab.profile').click(); await tid(p, 'screen.profile').waitFor(); await wait(p); }],
  ['settings', async (p) => { await tid(p, 'profile.settings').click(); await tid(p, 'screen.settings').waitFor(); await wait(p); }],
  ['create', async (p) => {
    await toTabs(p);
    await tid(p, 'nav.tab.map').click();
    await wait(p);
    await tid(p, 'map.fab.create').click();
    await tid(p, 'game.create.step').waitFor(); await wait(p);
  }],
];

const browser = await chromium.launch();
const server = await serve(DIST, PORT);
const tally = { critical: 0, serious: 0, moderate: 0, minor: 0 };
try {
  for (const locale of LOCALES) {
    for (const scheme of SCHEMES) {
      const ctx = await browser.newContext({
        viewport: { width: 393, height: 852 },
        isMobile: true,
        hasTouch: true,
        baseURL: `http://localhost:${PORT}`,
        locale: LOCALE_TAG[locale] ?? locale,
        colorScheme: scheme,
        reducedMotion: 'reduce',
        geolocation: { latitude: 32.0779, longitude: 34.7745 },
        permissions: ['geolocation'],
        timezoneId: 'Asia/Jerusalem',
      });
      const page = await ctx.newPage();
      for (const [name, go] of STEPS) {
        try {
          await go(page);
        } catch (e) {
          console.warn(`! ${locale}/${scheme} ${name}: ${String(e.message ?? e).split('\n')[0]}`);
          continue;
        }
        // Maplibre's canvas and the offline map art are decorative-by-design graphics.
        const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).exclude('.maplibregl-canvas').analyze();
        for (const v of res.violations) {
          tally[v.impact ?? 'minor'] += 1;
          if (!ALL && v.impact !== 'critical' && v.impact !== 'serious') continue;
          console.log(`[${v.impact}] ${locale}/${scheme} ${name}: ${v.id} — ${v.help} (${v.nodes.length})`);
          for (const n of v.nodes.slice(0, 4)) console.log(`    ${n.target.join(' ')} :: ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`);
        }
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`axe: ${tally.critical} critical, ${tally.serious} serious, ${tally.moderate} moderate, ${tally.minor} minor`);
process.exit(tally.critical + tally.serious > 0 ? 1 : 0);

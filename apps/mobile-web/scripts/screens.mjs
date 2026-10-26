#!/usr/bin/env node
/**
 * Screenshot tour of every main screen (design QA). Serves the static web export
 * (`dist/`, built with EXPO_PUBLIC_DATA=mock so the in-memory backend + OTP 123456
 * are available) and walks the app by clicking — a reload would reset the
 * in-memory data, so every flow navigates in-app.
 *
 * Build first:
 *   EXPO_PUBLIC_DATA=mock npx expo export --platform web --output-dir dist
 *
 * Usage:
 *   node scripts/screens.mjs                         # all screens, en+he × light+dark
 *   node scripts/screens.mjs --only map,game,design  # just these screens
 *   node scripts/screens.mjs --locale he --scheme dark
 *   node scripts/screens.mjs --list                  # print screen names
 *   SCREENS_OUT=/tmp/shots node scripts/screens.mjs  # output dir (default /tmp/st-screens)
 *
 * Flags: --only <a,b>  --locale <en|he|ar|…>[,…]  --scheme <light|dark>[,…]
 *        --port <n> (default 4319)  --dist <dir> (default ./dist)
 *        --full (every screen as scrolled parts, see scrollShots)
 * Output: <name>.<locale>.<scheme>.png  (scrolled screens: <name>.<locale>.<scheme>.<NN>.png)
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
};
const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);

const OUT = resolve(process.env.SCREENS_OUT ?? '/tmp/st-screens');
const ONLY = list(flag('only'), null);
const LOCALES = list(flag('locale'), ['en', 'he']);
const SCHEMES = list(flag('scheme'), ['light', 'dark']);
const PORT = Number(flag('port') ?? 4319);
const DIST = resolve(root, flag('dist') ?? 'dist');
const FULL = flag('full') === 'true';

const LOCALE_TAG = { en: 'en-US', he: 'he-IL', ar: 'ar-EG', es: 'es-ES', ru: 'ru-RU', de: 'de-DE', fr: 'fr-FR', ja: 'ja-JP', hi: 'hi-IN' };

/* ------------------------------------------------------------------ */
/* Static server with SPA fallback                                      */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.pbf': 'application/x-protobuf',
};

function serve(dir, port) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const safe = normalize(url).replace(/^(\.\.[/\\])+/, '');
    const candidates = [join(dir, safe), join(dir, `${safe}.html`), join(dir, safe, 'index.html')];
    let file = candidates.find((p) => p.startsWith(dir) && existsSync(p) && statSync(p).isFile());
    if (!file) file = join(dir, 'index.html'); // SPA fallback
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const DANA = { country: 'IL', national: '500000001' }; // demo host: hosts g-tlv-6/9, player in g-tlv-1
const YOSSI = { country: 'IL', national: '500000002' }; // host of g-tlv-1 (QR, teams)

const tid = (page, id) => page.getByTestId(id);
const settle = (page, ms = 700) => page.waitForTimeout(ms);

async function visible(page, id, timeout = 8000) {
  await tid(page, id).first().waitFor({ state: 'visible', timeout });
}

async function isVisible(page, id) {
  return tid(page, id).first().isVisible().catch(() => false);
}

async function click(page, id) {
  await tid(page, id).filter({ visible: true }).first().click();
}

async function signIn(page, who, inApp = false) {
  if (!inApp) await page.goto('/');
  await visible(page, 'auth.phone.input', 20000);
  if (who.country) await tid(page, 'auth.phone.country').selectOption(who.country).catch(() => undefined);
  await tid(page, 'auth.phone.input').fill(who.national);
  await click(page, 'auth.phone.submit');
  await visible(page, 'auth.otp.input');
  await tid(page, 'auth.otp.input').fill('123456');
  await page.waitForURL(/\/(map|age-gate)$/, { timeout: 15000 });
  await dismissLocation(page);
}

async function dismissLocation(page) {
  await settle(page, 400);
  if (await isVisible(page, 'map.location.notNow')) await click(page, 'map.location.notNow');
}

async function back(page) {
  await tid(page, 'nav.back').filter({ visible: true }).last().click();
  await settle(page, 400);
}

async function backToTabs(page) {
  for (let i = 0; i < 6 && !(await isVisible(page, 'nav.tab.profile')); i++) await back(page);
}

async function openListIfCollapsed(page) {
  const card = tid(page, 'map.card.g-tlv-1');
  if (await card.isVisible().catch(() => false)) return;
  if (await isVisible(page, 'map.list.toggle')) await click(page, 'map.list.toggle');
  await settle(page, 500);
}

/* ------------------------------------------------------------------ */
/* Flows. Each step: { name?, run }. Steps without a name only navigate. */
/* ------------------------------------------------------------------ */

const newPhone = () => '201555' + String(Date.now()).slice(-4);

const FLOWS = [
  {
    id: 'auth',
    steps: [
      { run: async (p) => { await p.goto('/'); await visible(p, 'auth.phone.input', 20000); } },
      { name: 'phone', run: async () => {} },
      {
        run: async (p) => {
          await tid(p, 'auth.phone.input').fill(newPhone());
          await click(p, 'auth.phone.submit');
          await visible(p, 'auth.otp.input');
        },
      },
      { name: 'otp', run: async () => {} },
      { run: async (p) => { await tid(p, 'auth.otp.input').fill('123456'); await p.waitForURL(/\/age-gate$/); await visible(p, 'auth.age.month'); } },
      { name: 'age', run: async () => {} },
      {
        run: async (p) => {
          await tid(p, 'auth.age.month').selectOption('5');
          await tid(p, 'auth.age.year').selectOption(String(new Date().getFullYear() - 25));
          await click(p, 'auth.age.submit');
          await visible(p, 'auth.onboarding.name');
          await tid(p, 'auth.onboarding.name').fill('Alex Runner');
          await click(p, 'auth.onboarding.sport.football').catch(() => undefined);
        },
      },
      { name: 'onboarding', run: async () => {} },
    ],
  },
  {
    id: 'dana',
    steps: [
      { run: async (p) => { await signIn(p, DANA); await visible(p, 'map.canvas', 15000); await settle(p, 1500); } },
      { name: 'map', run: async () => {} },
      { run: async (p) => openListIfCollapsed(p) },
      { name: 'map-list', run: async () => {} },
      {
        run: async (p) => {
          const venue = p.locator('[data-testid^="map.venueCard."]').first();
          await venue.scrollIntoViewIfNeeded();
          await venue.click();
          await visible(p, 'map.venue.sheet');
        },
      },
      { name: 'venue-sheet', run: async () => {} },
      {
        run: async (p) => {
          if (await isVisible(p, 'map.venue.close')) await click(p, 'map.venue.close');
          await settle(p, 400);
          await openListIfCollapsed(p);
          await tid(p, 'map.card.g-tlv-1').first().click();
          await p.waitForURL(/\/game\/g-tlv-1$/);
          await visible(p, 'game.title');
        },
      },
      { name: 'game', run: async () => {} },
      { run: async (p) => { await click(p, 'game.chat'); await visible(p, 'chat.list'); } },
      { name: 'chat', run: async () => {} },
      { run: async (p) => { await back(p); await click(p, 'game.checkin'); await visible(p, 'checkin.gps'); } },
      { name: 'checkin', run: async () => {} },
      { run: async (p) => { await backToTabs(p); await click(p, 'nav.tab.games'); await visible(p, 'screen.games'); } },
      { name: 'games', run: async () => {} },
      {
        run: async (p) => {
          await click(p, 'games.segment.past');
          await click(p, 'games.card.g-tlv-9');
          await click(p, 'game.result');
          await visible(p, 'result.window');
        },
      },
      { name: 'result', run: async () => {} },
      { run: async (p) => { await backToTabs(p); await click(p, 'nav.tab.inbox'); await visible(p, 'screen.inbox'); } },
      { name: 'inbox', run: async () => {} },
      { run: async (p) => { await click(p, 'nav.tab.profile'); await visible(p, 'screen.profile'); } },
      { name: 'profile', run: async () => {} },
      {
        run: async (p) => {
          const s = p.locator('[data-testid^="profile.sanction."]').first();
          await s.scrollIntoViewIfNeeded();
          await s.click();
          await visible(p, 'sanctions.statement');
        },
      },
      { name: 'sanctions', run: async () => {} },
      { run: async (p) => { await backToTabs(p); await click(p, 'nav.tab.profile'); await click(p, 'profile.settings'); await visible(p, 'screen.settings'); } },
      { name: 'settings', run: async () => {} },
      { run: async (p) => { await click(p, 'settings.language.open'); await visible(p, 'settings.language'); } },
      { name: 'language', run: async () => {} },
      {
        run: async (p) => {
          await backToTabs(p);
          await click(p, 'nav.tab.map');
          await dismissLocation(p);
          if (await isVisible(p, 'map.fab.create')) await click(p, 'map.fab.create');
          else await click(p, 'nav.rail.create');
          await visible(p, 'game.create.step');
        },
      },
      { name: 'create-1', run: async (p) => { await click(p, 'game.create.sport.football'); await tid(p, 'game.create.title').fill('Sunday 5-a-side').catch(() => undefined); } },
      { run: async (p) => { await click(p, 'game.create.next'); await settle(p, 400); } },
      { name: 'create-2', run: async (p) => { const v = p.locator('[data-testid^="game.create.venue."]').first(); if (await v.isVisible().catch(() => false)) await v.click(); } },
      { run: async (p) => { await click(p, 'game.create.next'); await settle(p, 400); } },
      { name: 'create-3', run: async () => {} },
      { run: async (p) => { await click(p, 'game.create.next'); await settle(p, 400); } },
      { name: 'create-4', run: async () => {} },
      { run: async (p) => { await click(p, 'game.create.next'); await settle(p, 400); } },
      { name: 'create-5', run: async () => {} },
      { run: async (p) => { await click(p, 'game.create.next'); await visible(p, 'game.create.review'); } },
      { name: 'create-review', run: async () => {} },
    ],
  },
  {
    id: 'yossi',
    steps: [
      { run: async (p) => { await signIn(p, YOSSI); await openListIfCollapsed(p); await tid(p, 'map.card.g-tlv-1').first().click(); await visible(p, 'game.title'); } },
      { name: 'game-host', run: async () => {} },
      { run: async (p) => { await click(p, 'game.host.qr'); await visible(p, 'checkin.qr.show'); await settle(p, 800); } },
      { name: 'host-qr', run: async () => {} },
      { run: async (p) => { await back(p); await click(p, 'game.host.teams'); await visible(p, 'teams.balance'); } },
      { name: 'teams', run: async () => {} },
    ],
  },
  {
    id: 'design',
    steps: [
      { run: async (p) => { await p.goto('/dev/design'); await visible(p, 'dev.design', 20000); await settle(p, 1200); } },
      { name: 'design', scroll: true, run: async () => {} },
    ],
  },
];

const ALL_NAMES = FLOWS.flatMap((f) => f.steps.filter((s) => s.name).map((s) => s.name));

/**
 * RN-web screens scroll inside a ScrollView (not the document), so a fullPage shot misses
 * content. Scroll the largest scroller page by page and save <base>.<n>.png parts.
 */
async function scrollShots(page, base) {
  const files = [];
  const total = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible');
    els.sort((a, b) => b.scrollHeight - a.scrollHeight);
    const el = els[0];
    if (!el) return 0;
    el.setAttribute('data-shot-scroller', '1');
    return Math.ceil(el.scrollHeight / (el.clientHeight * 0.88));
  });
  const n = Math.max(1, Math.min(total, 20));
  for (let i = 0; i < n; i++) {
    await page.evaluate((idx) => {
      const el = document.querySelector('[data-shot-scroller]');
      if (el) el.scrollTop = idx * el.clientHeight * 0.88;
    }, i);
    await settle(page, 350);
    const f = `${base}.${String(i + 1).padStart(2, '0')}.png`;
    await page.screenshot({ path: f });
    files.push(f);
  }
  return files;
}

/* ------------------------------------------------------------------ */
/* Runner                                                               */
/* ------------------------------------------------------------------ */

async function runFlow(browser, flow, locale, scheme, base) {
  const wanted = flow.steps.filter((s) => s.name && (!ONLY || ONLY.includes(s.name)));
  if (!wanted.length) return [];
  const lastWanted = flow.steps.lastIndexOf(wanted[wanted.length - 1]);
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    baseURL: base,
    locale: LOCALE_TAG[locale] ?? locale,
    colorScheme: scheme,
    reducedMotion: 'reduce',
    geolocation: { latitude: 32.0779, longitude: 34.7745, accuracy: 10 },
    permissions: ['geolocation'],
    timezoneId: 'Asia/Jerusalem',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shots = [];
  try {
    // A failed navigation step skips the next named screen (it would show the wrong page);
    // later navigation steps still run, since most start from a known place (tabs, back).
    let navOk = true;
    let failures = 0;
    for (let i = 0; i <= lastWanted && failures < 4; i++) {
      const step = flow.steps[i];
      try {
        await step.run(page);
        if (!step.name) navOk = true;
      } catch (e) {
        failures++;
        console.warn(`  ! ${flow.id}[${step.name ?? i}] ${locale}/${scheme}: ${String(e.message ?? e).split('\n')[0]}`);
        if (!step.name) navOk = false;
      }
      if (step.name && !navOk) {
        console.warn(`  - skipped ${step.name} (navigation failed)`);
        continue;
      }
      if (step.name && (!ONLY || ONLY.includes(step.name))) {
        await settle(page, 500);
        const file = join(OUT, `${step.name}.${locale}.${scheme}.png`);
        if (step.scroll || FULL) {
          const parts = await scrollShots(page, join(OUT, `${step.name}.${locale}.${scheme}`));
          shots.push(...parts);
          for (const f of parts) console.log(`  ✓ ${f}`);
        } else {
          await page.screenshot({ path: file });
          shots.push(file);
          console.log(`  ✓ ${file}`);
        }
      }
    }
  } finally {
    if (errors.length) console.warn(`  page errors (${flow.id}): ${errors.slice(0, 3).join(' | ')}`);
    await context.close();
  }
  return shots;
}

async function main() {
  if (argv.includes('--list')) {
    console.log(ALL_NAMES.join('\n'));
    return;
  }
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error(`No export at ${DIST}. Run: EXPO_PUBLIC_DATA=mock npx expo export --platform web --output-dir dist`);
    process.exit(1);
  }
  if (ONLY) {
    const unknown = ONLY.filter((n) => !ALL_NAMES.includes(n));
    if (unknown.length) console.warn(`Unknown screen names: ${unknown.join(', ')} (see --list)`);
  }
  mkdirSync(OUT, { recursive: true });
  const server = await serve(DIST, PORT);
  const base = `http://localhost:${PORT}`;
  const browser = await chromium.launch();
  let count = 0;
  try {
    for (const locale of LOCALES) {
      for (const scheme of SCHEMES) {
        console.log(`▶ ${locale} / ${scheme}`);
        for (const flow of FLOWS) count += (await runFlow(browser, flow, locale, scheme, base)).length;
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`Done: ${count} screenshots in ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

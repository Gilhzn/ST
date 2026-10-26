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
 *        --device <phone|pixel7|desktop> (default phone: 393×852, iPhone 15 / Pixel 8 class)
 *        --full (every screen as scrolled parts, see scrollShots)
 * Console errors/warnings and page errors are collected and printed per flow.
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
const DEVICE = flag('device') ?? 'phone';

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

/** Phones: switch the map screen to its list view (wide layouts always show the list pane). */
async function showListView(page) {
  if (await isVisible(page, 'map.list')) return;
  if (await isVisible(page, 'map.list.toggle')) await click(page, 'map.list.toggle');
  await settle(page, 500);
}

/** Mock-adapter QA hook (InMemoryAdapter.run): artificial latency / offline without a reload. */
async function mock(page, value) {
  await page.evaluate((v) => {
    globalThis.__ST_MOCK__ = v;
  }, value);
}

/** In-app navigation via the History API (a reload would reset the in-memory data). */
async function pushPath(page, path) {
  await page.evaluate((to) => {
    window.history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
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
      { run: async (p) => showListView(p) },
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
        },
      },
      // Empty state: one sport with no games nearby, smallest radius.
      {
        name: 'map-empty',
        run: async (p) => {
          await click(p, 'map.filter.sport.tennis');
          await click(p, 'map.filter.radius.1');
          await visible(p, 'map.sheet.title');
          await settle(p, 700);
        },
      },
      // Network error (mock offline): change the radius so the list refetches.
      {
        name: 'map-error',
        run: async (p) => {
          await mock(p, { offline: true });
          await click(p, 'map.filter.radius.2');
          await settle(p, 900);
        },
      },
      {
        run: async (p) => {
          await mock(p, {});
          await click(p, 'map.filter.sport.tennis');
          await click(p, 'map.filter.radius.5');
          await settle(p, 700);
          await mock(p, { latencyMs: 8000 });
          await tid(p, 'map.card.g-tlv-1').first().click();
          await p.waitForURL(/\/game\/g-tlv-1$/);
        },
      },
      // Loading skeleton (mock latency) on game details, then the loaded screen.
      { name: 'game-loading', run: async (p) => settle(p, 400) },
      { run: async (p) => { await mock(p, {}); await visible(p, 'game.title', 15000); } },
      { name: 'game', run: async () => {} },
      {
        name: 'game-scrolled',
        run: async (p) => {
          await p.evaluate(() => {
            const els = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY !== 'visible');
            els.sort((a, b) => b.scrollHeight - a.scrollHeight);
            if (els[0]) els[0].scrollTop = els[0].scrollHeight;
          });
          await settle(p, 500);
        },
      },
      { run: async (p) => { await click(p, 'game.chat'); await visible(p, 'chat.list'); } },
      { name: 'chat', run: async () => {} },
      // Extra chat states (Developer B): moderation nudge, server block, translation, options sheet.
      {
        name: 'chat-nudge',
        run: async (p) => {
          await tid(p, 'chat.input').fill('ref was an idiot today');
          await click(p, 'chat.send');
          await visible(p, 'chat.nudge');
        },
      },
      {
        name: 'chat-block',
        run: async (p) => {
          await click(p, 'chat.nudge.sendAnyway');
          await visible(p, 'chat.nudge.server');
          await tid(p, 'chat.input').fill('I will kill you');
          await click(p, 'chat.send');
          await visible(p, 'chat.block');
          await click(p, 'chat.message.m-seed-3.translate');
          await visible(p, 'chat.message.m-seed-3.translated');
        },
      },
      { name: 'chat-menu', run: async (p) => { await click(p, 'chat.message.m-seed-3.options'); await visible(p, 'chat.menu'); } },
      { run: async (p) => { await p.keyboard.press('Escape'); await settle(p, 300); if (await isVisible(p, 'chat.menu')) await p.mouse.click(200, 80); await settle(p, 300); } },
      { run: async (p) => { await back(p); await click(p, 'game.checkin'); await visible(p, 'checkin.gps'); } },
      { name: 'checkin', run: async () => {} },
      // Extra check-in states (Developer B): a GPS verdict, then the code panel.
      { name: 'checkin-verdict', run: async (p) => { await click(p, 'checkin.gps.start'); await visible(p, 'checkin.status', 30000); await settle(p, 900); } },
      { name: 'checkin-code', run: async (p) => { await click(p, 'checkin.qr.enter'); await visible(p, 'checkin.qr.input'); } },
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
      { name: 'inbox-chats', run: async (p) => { await click(p, 'inbox.tab.chats'); await settle(p, 500); } },
      // Error state with Retry: open a game while the mock is offline.
      {
        name: 'game-error',
        run: async (p) => {
          await mock(p, { offline: true });
          await pushPath(p, '/game/g-tlv-1');
          await settle(p, 1200);
        },
      },
      { run: async (p) => { await mock(p, {}); await backToTabs(p); await click(p, 'nav.tab.inbox'); await visible(p, 'screen.inbox'); } },
      { run: async (p) => { await click(p, 'nav.tab.profile'); await visible(p, 'screen.profile'); } },
      { name: 'profile', run: async () => {} },
      // Extra profile/settings states (Developer B).
      { name: 'profile-edit', run: async (p) => { await click(p, 'profile.edit'); await visible(p, 'screen.profile.edit'); await settle(p, 500); } },
      { run: async (p) => { await click(p, 'profile.edit.cancel'); await settle(p, 400); } },
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
      { name: 'settings-notifications', run: async (p) => { await back(p); await click(p, 'settings.notifications.open'); await visible(p, 'settings.notifications'); } },
      { name: 'settings-privacy', run: async (p) => { await back(p); await click(p, 'settings.privacy.open'); await visible(p, 'settings.privacy.location'); } },
      { name: 'settings-delete', run: async (p) => { await back(p); await click(p, 'settings.delete.open'); await visible(p, 'settings.delete.review'); } },
      { name: 'legal', run: async (p) => { await back(p); await click(p, 'settings.legal.terms'); await visible(p, 'screen.legal.terms'); } },
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
      { name: 'create-published', run: async (p) => { await click(p, 'game.create.publish'); await visible(p, 'screen.game.create.done'); await settle(p, 900); } },
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
      // Developer B: the host's own check-in (already verified in the seed) shows the success state.
      {
        name: 'checkin-success',
        run: async (p) => {
          // No check-in button for hosts: navigate in-app via the History API (a reload would reset the mock data).
          await p.evaluate(() => {
            window.history.pushState({}, '', '/game/g-tlv-1/checkin');
            window.dispatchEvent(new PopStateEvent('popstate'));
          });
          await visible(p, 'screen.game.checkin');
          await settle(p, 900);
        },
      },
    ],
  },
  // Phase 1.5 (contract v3): series, WhatsApp invites, ratings, Media Vault, network.
  {
    id: 'p15-dana',
    steps: [
      { run: async (p) => { await signIn(p, DANA); await click(p, 'nav.tab.games'); await visible(p, 'games.series', 15000); await settle(p, 900); } },
      { name: 'games-p15', run: async () => {} },
      { run: async (p) => { await click(p, 'games.series.s-tlv-weekly'); await visible(p, 'series.facts'); await settle(p, 900); } },
      { name: 'series', scroll: true, run: async () => {} },
      { run: async (p) => { await p.evaluate(() => { const el = document.querySelector('[data-shot-scroller]'); if (el) el.scrollTop = 0; }); } },
      { name: 'series-skip', run: async (p) => { await click(p, 'series.occurrence.0.skip'); await visible(p, 'series.skipDialog'); await settle(p, 400); } },
      { run: async (p) => { await click(p, 'series.skipDialog.cancel'); await settle(p, 300); } },
      { name: 'series-edit', run: async (p) => { await click(p, 'series.host.edit'); await visible(p, 'series.edit'); await settle(p, 500); } },
      { run: async (p) => { await p.keyboard.press('Escape'); await settle(p, 300); if (await isVisible(p, 'series.edit')) await p.getByRole('button', { name: /cancel|ביטול/i }).first().click(); await settle(p, 300); } },
      { name: 'invite-group', scroll: true, run: async (p) => { await click(p, 'series.invite'); await visible(p, 'invite.preview'); await settle(p, 700); } },
      { name: 'invite-qr', run: async (p) => { await click(p, 'invite.qr'); await visible(p, 'invite.qr.code'); await tid(p, 'invite.qr.code').scrollIntoViewIfNeeded(); await settle(p, 500); } },
      { run: async (p) => { await back(p); await back(p); await backToTabs(p); await click(p, 'nav.tab.games'); await visible(p, 'games.series.s-lon-5s'); await click(p, 'games.series.s-lon-5s'); await visible(p, 'series.facts'); await settle(p, 800); } },
      { name: 'series-invited', run: async () => {} },
      { name: 'game-priority', run: async (p) => { await click(p, 'series.occurrence.0.open'); await visible(p, 'game.priority.banner'); await settle(p, 700); } },
      {
        run: async (p) => {
          await backToTabs(p);
          await click(p, 'nav.tab.games');
          await click(p, 'games.segment.past');
          await click(p, 'games.card.g-tlv-9');
          await visible(p, 'game.after');
          await tid(p, 'game.after').scrollIntoViewIfNeeded();
          await settle(p, 600);
        },
      },
      { name: 'game-after', run: async () => {} },
      { name: 'gallery', run: async (p) => { await click(p, 'game.after.gallery'); await visible(p, 'gallery.grid'); await settle(p, 900); } },
      { name: 'gallery-viewer', scroll: true, run: async (p) => { await click(p, 'gallery.item.0'); await visible(p, 'gallery.viewer'); await settle(p, 700); } },
      { run: async (p) => { await click(p, 'gallery.viewer.close'); await settle(p, 300); await back(p); await click(p, 'game.after.result'); await visible(p, 'result.window'); await click(p, 'result.inc.0'); await click(p, 'result.submit'); await settle(p, 900); await click(p, 'game.after.result'); await visible(p, 'result.confirm'); await settle(p, 700); } },
      { name: 'result-confirm', scroll: true, run: async () => {} },
      { name: 'rate-gate', run: async (p) => { await back(p); await click(p, 'game.after.rate'); await visible(p, 'rate.gate'); await settle(p, 600); } },
      { run: async (p) => { await backToTabs(p); await click(p, 'nav.tab.inbox'); await visible(p, 'inbox.requests'); await settle(p, 700); } },
      { name: 'inbox-requests', run: async () => {} },
      { run: async (p) => { await click(p, 'nav.tab.profile'); await visible(p, 'profile.levels'); await settle(p, 900); } },
      { name: 'profile-p15', scroll: true, run: async () => {} },
      { name: 'players', run: async (p) => { await tid(p, 'profile.players').scrollIntoViewIfNeeded(); await click(p, 'profile.players'); await visible(p, 'players.friends'); await settle(p, 600); } },
      { name: 'players-played', run: async (p) => { await click(p, 'players.tab.played'); await visible(p, 'players.played'); await settle(p, 500); } },
      { name: 'players-requests', run: async (p) => { await click(p, 'players.tab.requests'); await visible(p, 'players.requests'); await settle(p, 500); } },
      {
        run: async (p) => {
          await backToTabs(p);
          await click(p, 'nav.tab.map');
          await dismissLocation(p);
          await showListView(p);
          // The list is virtualised: wheel down until the venue section renders.
          const venue = p.locator('[data-testid="map.venueCard.v-tlv-clore"]').first();
          for (let i = 0; i < 20 && !(await venue.isVisible().catch(() => false)); i++) {
            await p.mouse.move(200, 700);
            await p.mouse.wheel(0, 1200);
            await settle(p, 250);
          }
          await venue.scrollIntoViewIfNeeded();
          await venue.click();
          await visible(p, 'map.venue.sheet');
          await click(p, 'map.venue.tab.photos');
          await visible(p, 'venue.photos.grid');
          await tid(p, 'venue.photos').scrollIntoViewIfNeeded();
          await settle(p, 700);
        },
      },
      { name: 'venue-photos', run: async () => {} },
      {
        run: async (p) => {
          if (await isVisible(p, 'map.venue.close')) await click(p, 'map.venue.close');
          await backToTabs(p);
          await click(p, 'nav.tab.map');
          await dismissLocation(p);
          if (await isVisible(p, 'map.fab.create')) await click(p, 'map.fab.create');
          else await click(p, 'nav.rail.create');
          await visible(p, 'game.create.step');
          await click(p, 'game.create.sport.football');
          await click(p, 'game.create.next');
          const v = p.locator('[data-testid^="game.create.venue."]').first();
          await v.click();
          await click(p, 'game.create.next');
          await click(p, 'game.create.repeat.weekly');
          await settle(p, 400);
        },
      },
      { name: 'create-repeat', scroll: true, run: async () => {} },
      { run: async (p) => { for (let i = 0; i < 3; i++) { await click(p, 'game.create.next'); await settle(p, 300); } await visible(p, 'game.create.review'); } },
      { name: 'create-series-review', run: async () => {} },
      { name: 'create-series-published', run: async (p) => { await click(p, 'game.create.publish'); await visible(p, 'game.create.series.card'); await settle(p, 900); } },
    ],
  },
  {
    id: 'p15-yossi',
    steps: [
      { run: async (p) => { await signIn(p, YOSSI); await click(p, 'nav.tab.games'); await click(p, 'games.segment.past'); await click(p, 'games.card.g-tlv-wk-1'); await visible(p, 'game.after'); await tid(p, 'game.after').scrollIntoViewIfNeeded(); await settle(p, 700); } },
      { name: 'game-series-past', run: async () => {} },
      { name: 'result-confirm-player', run: async (p) => { await click(p, 'game.after.result'); await visible(p, 'result.confirm'); await tid(p, 'result.confirm').scrollIntoViewIfNeeded(); await settle(p, 700); } },
      { run: async (p) => { await back(p); await click(p, 'game.after.rate'); await visible(p, 'screen.game.rate'); await settle(p, 500); } },
      { name: 'rate', run: async () => {} },
      {
        name: 'rate-filled',
        scroll: true,
        run: async (p) => {
          const picks = p.locator('[data-testid^="rate.pick."]');
          await picks.nth(0).click();
          await picks.nth(1).click();
          const id = ((await picks.nth(0).getAttribute('data-testid')) ?? '').replace('rate.pick.', '');
          await click(p, `rate.${id}.speed.4`);
          await click(p, `rate.${id}.passing.5`);
          await click(p, `rate.${id}.overall.4`);
          await settle(p, 400);
        },
      },
      { run: async (p) => { await backToTabs(p); await click(p, 'nav.tab.games'); await click(p, 'games.segment.upcoming'); await click(p, 'games.card.g-tlv-1'); await visible(p, 'game.title'); await click(p, 'game.players.toggle'); await tid(p, 'game.players').scrollIntoViewIfNeeded(); await settle(p, 700); } },
      { name: 'game-host-bands', run: async () => {} },
    ],
  },
  {
    id: 'p15-new',
    steps: [
      { run: async (p) => { await p.goto('/invite/series/tlv-weekly-football-regulars'); await visible(p, 'screen.invite.series', 20000); await settle(p, 900); } },
      { name: 'invite-series-signedout', run: async () => {} },
      {
        run: async (p) => {
          await click(p, 'invite.series.signup');
          await visible(p, 'auth.phone.input');
          await tid(p, 'auth.phone.input').fill(newPhone());
          await click(p, 'auth.phone.submit');
          await visible(p, 'auth.otp.input');
          await tid(p, 'auth.otp.input').fill('123456');
          await p.waitForURL(/\/age-gate$/);
          await tid(p, 'auth.age.month').selectOption('5');
          await tid(p, 'auth.age.year').selectOption(String(new Date().getFullYear() - 25));
          await click(p, 'auth.age.submit');
          await visible(p, 'auth.onboarding.name');
          await tid(p, 'auth.onboarding.name').fill('Alex Runner');
          await click(p, 'auth.onboarding.sport.football');
          await click(p, 'auth.onboarding.submit');
          await visible(p, 'screen.series', 20000);
          await settle(p, 900);
        },
      },
      { name: 'invite-series-joined', run: async () => {} },
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
  const deviceProfile =
    DEVICE === 'pixel7'
      ? devices['Pixel 7']
      : DEVICE === 'desktop'
        ? { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false }
        : { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['Pixel 7'].userAgent };
  const context = await browser.newContext({
    ...deviceProfile,
    baseURL: base,
    locale: LOCALE_TAG[locale] ?? locale,
    colorScheme: scheme,
    reducedMotion: 'reduce',
    geolocation: { latitude: 32.0779, longitude: 34.7745, accuracy: 10 },
    permissions: ['geolocation'],
    timezoneId: 'Asia/Jerusalem',
  });
  const page = await context.newPage();
  if (process.env.SCREENS_DEBUG) page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.warn(`    nav: ${f.url()}`); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const consoleMsgs = new Set();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.add(`${m.type()}: ${m.text().split('\n')[0].slice(0, 200)}`);
  });
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
        if (process.env.SCREENS_DEBUG) {
          await page.screenshot({ path: resolve(OUT, `FAIL-${flow.id}-${step.name ?? i}.${locale}.${scheme}.png`) }).catch(() => {});
          const ids = await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((n) => n.getAttribute('data-testid'))).catch(() => []);
          console.warn(`    testids: ${ids.slice(0, 120).join(' ')}`);
        }
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
    for (const m of consoleMsgs) console.warn(`  console ${flow.id} ${locale}/${scheme}: ${m}`);
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

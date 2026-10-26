#!/usr/bin/env node
/**
 * Smoke-tests `dist-artifact/` the way the claude.ai Artifact viewer runs it:
 * - files served under a random sub-path, with NO SPA fallback (root-absolute URLs 404);
 * - the page wrapped in the host skeleton and loaded inside a sandboxed iframe with a CSP;
 * - a second pass with localStorage blocked.
 * Walks phone → OTP → age gate → onboarding → map → game details at Pixel 7 size and fails
 * on any 404, page error or console error. Screenshots go to $ARTIFACT_SHOTS (default /tmp/st-artifact).
 *
 * Usage: node scripts/test-artifact.mjs   (after scripts/build-artifact.mjs)
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist-artifact');
const shots = process.env.ARTIFACT_SHOTS ?? '/tmp/st-artifact';
mkdirSync(shots, { recursive: true });
const SUB = `/a${Math.random().toString(36).slice(2, 8)}/v1/`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const CSP = "default-src 'self' 'unsafe-inline' data: blob:; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; frame-ancestors 'self'";

const skeleton = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}</style>
${readFileSync(join(root, 'index.html'), 'utf8')}</head><body></body></html>`;
const host = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><iframe src="${SUB}index.html" sandbox="allow-scripts allow-same-origin allow-forms" style="border:0;width:100vw;height:100vh"></iframe></body></html>`;

const missing = [];
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/') return send(res, 200, 'text/html', host);
  if (!path.startsWith(SUB)) { missing.push(path); return send(res, 404, 'text/plain', 'not found'); }
  const rel = path.slice(SUB.length) || 'index.html';
  if (rel === 'index.html') return send(res, 200, 'text/html', skeleton, { 'content-security-policy': CSP });
  const file = join(root, rel);
  if (!existsSync(file) || statSync(file).isDirectory()) { missing.push(path); return send(res, 404, 'text/plain', 'not found'); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP });
  createReadStream(file).pipe(res);
});
function send(res, status, type, body, extra = {}) { res.writeHead(status, { 'content-type': type, ...extra }); res.end(body); }

await new Promise((r) => server.listen(0, r));
const origin = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();
let failed = false;

for (const blockStorage of [false, true]) {
  const label = blockStorage ? 'no-storage' : 'default';
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL' });
  if (blockStorage) {
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console ${m.text()}`); });
  missing.length = 0;
  try {
    await page.goto(origin + '/', { waitUntil: 'load' });
    const f = page.frameLocator('iframe');
    await f.getByTestId('auth.phone.input').fill('521234567', { timeout: 20000 });
    await page.screenshot({ path: `${shots}/${label}-1-phone.png` });
    await f.getByTestId('auth.phone.submit').click();
    await f.getByTestId('auth.otp.input').fill('123456');
    await f.getByTestId('auth.age.month').selectOption('5', { timeout: 15000 });
    await f.getByTestId('auth.age.year').selectOption('1995');
    await f.getByTestId('auth.age.submit').click();
    await f.getByTestId('auth.onboarding.name').fill('גיל', { timeout: 15000 });
    await f.getByTestId('auth.onboarding.submit').click();
    const notNow = f.getByTestId('map.location.notNow');
    if (await notNow.count()) await notNow.click();
    const card = f.locator('[data-testid^="map.card."]').first();
    await card.waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${shots}/${label}-2-map.png` });
    await card.click();
    await f.getByTestId('game.title').waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${shots}/${label}-3-game.png` });
  } catch (e) {
    errors.push(`flow ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `${shots}/${label}-failure.png` }).catch(() => {});
  }
  const problems = [...errors, ...missing.map((m) => `404 ${m}`)];
  console.log(`[${label}] ${problems.length ? 'FAIL' : 'OK'}${problems.length ? '\n  ' + problems.join('\n  ') : ''}`);
  if (problems.length) failed = true;
  await ctx.close();
}

await browser.close();
server.close();
console.log(`screenshots: ${shots}`);
process.exit(failed ? 1 : 0);

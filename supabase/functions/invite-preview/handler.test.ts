import { describe, expect, it } from 'vitest';
import type { InvitePreview } from '@st/domain';
import { escapeHtml, safeHttpUrl } from '#shared/html';
import { createInviteLocalizer, matchLocale, negotiateLocale, type InviteCatalogs } from '#shared/invite-copy';
import { allowAll, memoryLogger } from '../_test/helpers';
import { buildPage, handle, tokenFrom, type InvitePreviewDeps } from './handler';

const TOKEN = 'AbCdEf123456_-xyz';
const OG = 'https://app.sporttalent.test';

const PREVIEW: InvitePreview = {
  sport: 'football',
  title: 'Tuesday 5-a-side',
  startsAt: '2026-11-10T18:00:00.000Z',
  timeZone: 'Asia/Jerusalem',
  recurrence: 'weekly',
  weekday: 2,
  localStartTime: '20:00',
  areaLabel: 'Florentin, Tel Aviv',
  spotsLeft: 3,
  capacity: 10,
  womenOnly: false,
  hostDisplayName: 'Dana',
  ogImageUrl: null,
};

const CATALOGS: InviteCatalogs = {
  en: { sports: { football: 'Football' }, invite: { from: '{name} invited you to play', join: 'Join', expired: 'This invite has expired. Ask the host for a new link.' } },
  he: { sports: { football: 'כדורגל' }, invite: { from: '{name} הזמין/ה אותך לשחק', join: 'הצטרפות' }, preview: { spotsLeft: '{count, plural, one {נשאר מקום אחד} other {נשארו # מקומות}}', weekly: 'כל יום {weekday} ב-{time}' } },
};

function setup(preview: InvitePreview | null = PREVIEW, opts: { fail?: boolean } = {}) {
  const calls: string[] = [];
  const log = memoryLogger();
  const deps: InvitePreviewDeps = {
    store: {
      getInvitePreview: async (t) => {
        calls.push(t);
        if (opts.fail) throw new Error('db down');
        return t === TOKEN ? preview : null;
      },
    },
    l10n: createInviteLocalizer(CATALOGS),
    ogBaseUrl: OG,
    rateLimiter: allowAll,
    log,
  };
  const get = (path: string, headers: Record<string, string> = {}, method = 'GET') => handle(new Request(`https://fn.test/functions/v1/${path}`, { method, headers }), deps);
  return { deps, calls, log, get };
}

/** All `<meta>` tags as [key, content] pairs (attribute values unescaped for assertions). */
function metas(doc: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Intl may use narrow no-break spaces ("8:00\u202FPM"); normalise for readable assertions.
  for (const m of doc.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)">/g)) out[m[1] as string] = (m[2] as string).replace(/[\u202F\u00A0]/g, ' ');
  return out;
}

describe('invite-preview', () => {
  it('renders OG + Twitter tags with sport, day/time, area, spots and the per-sport image; redirects humans to /invite/<token>', async () => {
    const { get, calls } = setup();
    const res = await get(`invite-preview/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const doc = await res.text();
    const m = metas(doc);
    expect(calls).toEqual([TOKEN]);
    expect(m['og:title']).toBe('Football: Tuesday 5-a-side');
    expect(m['og:description']).toBe('Every Tuesday at 8:00 PM · Florentin, Tel Aviv · 3 spots left. Dana invited you to play');
    expect(m['og:image']).toBe(`${OG}/og/football.png`);
    expect(m['og:url']).toBe(`${OG}/invite/${TOKEN}`);
    expect(m['twitter:card']).toBe('summary_large_image');
    expect(m['twitter:image']).toBe(`${OG}/og/football.png`);
    expect(m['robots']).toBe('noindex, nofollow');
    expect(doc).toContain(`<meta http-equiv="refresh" content="0; url=${OG}/invite/${TOKEN}">`);
    expect(doc).toContain(`<a href="${OG}/invite/${TOKEN}" rel="noopener">Join</a>`);
    expect(doc).not.toMatch(/<script/i);
  });

  it('one-off games show the local date and time in the game time zone; full games say so', async () => {
    const { deps } = setup();
    const page = buildPage({ ...PREVIEW, recurrence: null, weekday: null, localStartTime: null, spotsLeft: 0, womenOnly: true }, TOKEN, 'en', deps);
    expect(page.description.replace(/[\u202F\u00A0]/g, ' ')).toBe('Tue, Nov 10, 8:00 PM · Florentin, Tel Aviv · Full, join the waitlist · Women only. Dana invited you to play');
    // One-off games without a series time zone: UTC, labelled.
    const utc = buildPage({ ...PREVIEW, recurrence: null, weekday: null, localStartTime: null, timeZone: null }, TOKEN, 'en', deps);
    expect(utc.description.replace(/[\u202F\u00A0]/g, ' ')).toMatch(/^Tue, Nov 10, 6:00 PM UTC · /);
  });

  it('localises via ?lang= and Accept-Language (RTL for Hebrew), falling back to English per key', async () => {
    const { get } = setup();
    const he = await (await get(`invite-preview/${TOKEN}?lang=he`)).text();
    expect(he).toContain('<html lang="he" dir="rtl">');
    const m = metas(he);
    expect(m['og:title']).toBe('כדורגל: Tuesday 5-a-side');
    expect(m['og:description']).toContain('נשארו 3 מקומות');
    expect(m['og:description']).toContain('Dana הזמין/ה אותך לשחק');
    expect(m['og:locale']).toBe('he_IL');
    const viaHeader = await (await get(`invite-preview/${TOKEN}`, { 'accept-language': 'fr-CH;q=0.4, iw-IL;q=0.9, *;q=0.1' })).text();
    expect(viaHeader).toContain('<html lang="he" dir="rtl">');
    const fr = await (await get(`invite-preview/${TOKEN}`, { 'accept-language': 'fr-FR' })).text();
    expect(fr).toContain('<html lang="fr" dir="ltr">');
    expect(metas(fr)['og:title']).toBe('Football: Tuesday 5-a-side'); // no fr catalog → English copy
    expect(negotiateLocale('xx', 'zh-TW,zh;q=0.8')).toBe('zh-Hant');
    expect(matchLocale('zh-CN')).toBe('zh-Hans');
    expect(matchLocale('pt-BR')).toBe('pt');
    expect(matchLocale('"><script>')).toBeNull();
  });

  it('XSS: every interpolated value is escaped; javascript:/data: image URLs are never used', async () => {
    const evil: InvitePreview = {
      ...PREVIEW,
      sport: 'football"><script>alert(1)</script>' as InvitePreview['sport'],
      title: '"><script>alert(document.cookie)</script><meta http-equiv="refresh" content="0;url=https://evil.test">',
      areaLabel: "' onmouseover='alert(1)' x='",
      hostDisplayName: '<img src=x onerror=alert(1)>‮',
      ogImageUrl: 'javascript:alert(1)',
    };
    const { get } = setup(evil);
    const doc = await (await get(`invite-preview/${TOKEN}?lang=en`)).text();
    expect(doc).not.toMatch(/<script/i);
    expect(doc).not.toMatch(/<img/i);
    expect(doc).not.toContain('onerror=');
    expect(doc).not.toContain('onmouseover=');
    expect(doc).not.toContain('javascript:');
    expect(doc).not.toContain('evil.test">');
    expect(doc).not.toContain('‮');
    // Exactly one refresh, pointing at our app.
    expect(doc.match(/http-equiv="refresh"/g)).toHaveLength(1);
    expect(doc).toContain('&lt;script&gt;');
    // Unknown sport → default image, never the attacker-controlled value.
    expect(metas(doc)['og:image']).toBe(`${OG}/og/default.png`);
    // The tag structure is intact: every meta tag is well-formed and attribute-closed.
    for (const line of doc.split('\n').filter((l) => l.startsWith('<meta '))) expect(line).toMatch(/^<meta [a-z-]+="[^"<>]*"(?: content="[^"<>]*")?>$/);

    const data = await (await setup({ ...PREVIEW, ogImageUrl: 'data:image/svg+xml,<svg onload=alert(1)>' }).get(`invite-preview/${TOKEN}`)).text();
    expect(metas(data)['og:image']).toBe(`${OG}/og/football.png`);
    const custom = await (await setup({ ...PREVIEW, ogImageUrl: 'https://cdn.sporttalent.test/og/series-1.png?v=2&x="' }).get(`invite-preview/${TOKEN}`)).text();
    expect(metas(custom)['og:image']).toBe('https://cdn.sporttalent.test/og/series-1.png?v&#61;2&amp;x&#61;%22');
  });

  it('escapeHtml and safeHttpUrl', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&\`=`)).toBe('&lt;a href&#61;&quot;x&quot; onclick&#61;&#39;y&#39;&gt;&amp;&#96;&#61;');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml('a\u0000b‮c\uD800')).toBe('abc');
    expect(safeHttpUrl('https://user:pw@x.test/')).toBeNull();
    expect(safeHttpUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHttpUrl('https://x.test/a b')).toBe('https://x.test/a%20b');
  });

  it('unknown, malformed or missing tokens → generic 404 page without calling the DB for malformed ones', async () => {
    const { get, calls } = setup();
    const unknown = await get('invite-preview/ZZZZZZZZZZZZ');
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('cache-control')).toBe('no-store');
    expect(metas(await unknown.text())['og:description']).toBe('This invite has expired. Ask the host for a new link.');
    expect((await get('invite-preview/..%2F..%2Fetc')).status).toBe(404);
    expect((await get('invite-preview?t=%3Cscript%3E')).status).toBe(404);
    expect((await get('invite-preview')).status).toBe(404);
    expect(calls).toEqual(['ZZZZZZZZZZZZ']);
    expect((await get(`invite-preview?t=${TOKEN}`)).status).toBe(200);
    expect(tokenFrom(new URL(`https://x.test/invite-preview/${TOKEN}?t=other`))).toBe(TOKEN);
  });

  it('HEAD returns headers only; other methods 405; DB failure → 503 page; rate limited → 429; token never logged', async () => {
    const { get, log } = setup();
    const head = await get(`invite-preview/${TOKEN}`, {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await get(`invite-preview/${TOKEN}`, {}, 'POST')).status).toBe(405);
    expect(JSON.stringify(log.records)).not.toContain(TOKEN);
    const down = setup(PREVIEW, { fail: true });
    expect((await down.get(`invite-preview/${TOKEN}`)).status).toBe(503);
    const limited = setup();
    limited.deps.rateLimiter = { hit: async () => ({ allowed: false, remaining: 0, retryAfterMs: 2000 }) };
    const r = await limited.get(`invite-preview/${TOKEN}`);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('2');
  });
});

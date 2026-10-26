/**
 * invite-preview: public rich preview of an invite link (PRD §5.4, GAME-030).
 *
 * GET /invite-preview/<token>  or  /invite-preview?t=<token>   [&lang=he]
 * → 200 text/html with Open Graph + Twitter Card tags (title, sport, day/time,
 *   area, free spots, image) that WhatsApp/Telegram/iMessage crawlers read, and
 *   a meta refresh + link that sends humans to `<OG_BASE_URL>/invite/<token>`.
 *
 * - Data comes from `get_invite_preview(token)` called with the anon key: the
 *   RPC is anon-safe and never returns an address for a hidden-location game.
 * - Every interpolated value is HTML-escaped; URLs must be absolute http(s).
 *   The page carries a CSP without scripts, `noindex`, and no referrer.
 * - Language: `?lang=` → `Accept-Language` → English; copy from `@st/i18n`
 *   (`common:sports`, `games:invite`, `invite:preview`) with English fallbacks.
 * - Image: the RPC's `ogImageUrl` when it is https, else the web app's static
 *   per-sport image `<OG_BASE_URL>/og/<sport>.png` (1200×630).
 * Unknown or rotated tokens get a generic "expired" page (404) with the same shape.
 */
import { isRtlLocale, isSportId, type InvitePreview, type Locale } from '@st/domain';
import { escapeHtml, html, metaText, safeHttpUrl } from '#shared/html';
import { formatWhen, negotiateLocale, type InviteLocalizer } from '#shared/invite-copy';
import type { Logger } from '#shared/log';
import type { RateLimiter } from '#shared/runtime';

export interface InvitePreviewStore {
  /** `get_invite_preview(p_token)` as anon; `null` for unknown, rotated or expired tokens. */
  getInvitePreview(token: string): Promise<InvitePreview | null>;
}

export interface InvitePreviewDeps {
  store: InvitePreviewStore;
  l10n: InviteLocalizer;
  /** Public web app origin (https), e.g. `https://app.sporttalent.example`. */
  ogBaseUrl: string;
  rateLimiter: RateLimiter;
  /** `TRUSTED_PROXY_HOPS`: proxies we control that append to X-Forwarded-For (default 1). */
  trustedProxyHops?: number;
  log: Logger;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** `og:locale` values (language_TERRITORY). */
const OG_LOCALE: Readonly<Record<Locale, string>> = {
  en: 'en_US', he: 'he_IL', ar: 'ar_AR', es: 'es_ES', 'zh-Hans': 'zh_CN', 'zh-Hant': 'zh_TW', ja: 'ja_JP',
  pt: 'pt_BR', ru: 'ru_RU', fr: 'fr_FR', it: 'it_IT', de: 'de_DE', hi: 'hi_IN',
};

/** Extracts the token from `/invite-preview/<token>` or `?t=` / `?token=`. */
export function tokenFrom(url: URL): string | null {
  const segs = url.pathname.split('/').filter(Boolean);
  const i = segs.lastIndexOf('invite-preview');
  const fromPath = i >= 0 ? segs[i + 1] : undefined;
  const raw = fromPath ?? url.searchParams.get('t') ?? url.searchParams.get('token');
  if (!raw) return null;
  let t: string;
  try {
    t = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return TOKEN_RE.test(t) ? t : null;
}

export interface PreviewPage {
  locale: Locale;
  title: string;
  description: string;
  imageUrl: string;
  imageAlt: string;
  targetUrl: string;
  cta: string;
  siteName: string;
}

/** Builds the (unescaped) page model. Exported for tests. */
export function buildPage(preview: InvitePreview | null, token: string | null, locale: Locale, deps: Pick<InvitePreviewDeps, 'l10n' | 'ogBaseUrl'>): PreviewPage {
  const { l10n } = deps;
  const base = deps.ogBaseUrl.replace(/\/+$/, '');
  const targetUrl = token ? `${base}/invite/${encodeURIComponent(token)}` : base;
  const siteName = l10n.text(locale, 'siteName');
  if (!preview) {
    return {
      locale, title: siteName, description: l10n.text(locale, 'expired'), imageUrl: `${base}/og/default.png`, imageAlt: siteName, targetUrl, cta: siteName, siteName,
    };
  }
  const sport = isSportId(preview.sport) ? preview.sport : null;
  const sportName = sport ? l10n.sport(locale, sport) : siteName;
  const title = l10n.text(locale, 'title', { sport: sportName, title: metaText(preview.title, 80) });
  const parts: string[] = [];
  const when = formatWhen(preview, locale, l10n);
  if (when) parts.push(when);
  if (preview.areaLabel) parts.push(metaText(preview.areaLabel, 60));
  if (preview.spotsLeft !== null && Number.isFinite(preview.spotsLeft)) parts.push(l10n.text(locale, 'spotsLeft', { count: Math.max(0, Math.trunc(preview.spotsLeft)) }));
  if (preview.womenOnly) parts.push(l10n.text(locale, 'womenOnly'));
  const from = preview.hostDisplayName ? l10n.text(locale, 'from', { name: metaText(preview.hostDisplayName, 40) }) : '';
  const description = [parts.join(' · '), from].filter(Boolean).join('. ');
  const custom = safeHttpUrl(preview.ogImageUrl);
  const imageUrl = custom && custom.startsWith('https:') ? custom : `${base}/og/${sport ?? 'default'}.png`;
  return { locale, title: metaText(title, 120), description: metaText(description, 300), imageUrl, imageAlt: sportName, targetUrl, cta: l10n.text(locale, 'join'), siteName };
}

/** Renders the page. Every value is escaped here, at the sink. Exported for tests. */
export function renderPage(p: PreviewPage): string {
  const e = escapeHtml;
  const meta = (attr: 'property' | 'name', key: string, value: string) => `<meta ${attr}="${key}" content="${e(value)}">`;
  return [
    '<!doctype html>',
    `<html lang="${e(p.locale)}" dir="${isRtlLocale(p.locale) ? 'rtl' : 'ltr'}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${e(p.title)}</title>`,
    meta('name', 'description', p.description),
    '<meta name="robots" content="noindex, nofollow">',
    `<link rel="canonical" href="${e(p.targetUrl)}">`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', p.siteName),
    meta('property', 'og:locale', OG_LOCALE[p.locale]),
    meta('property', 'og:title', p.title),
    meta('property', 'og:description', p.description),
    meta('property', 'og:url', p.targetUrl),
    meta('property', 'og:image', p.imageUrl),
    meta('property', 'og:image:secure_url', p.imageUrl),
    meta('property', 'og:image:type', 'image/png'),
    meta('property', 'og:image:width', '1200'),
    meta('property', 'og:image:height', '630'),
    meta('property', 'og:image:alt', p.imageAlt),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', p.title),
    meta('name', 'twitter:description', p.description),
    meta('name', 'twitter:image', p.imageUrl),
    `<meta http-equiv="refresh" content="0; url=${e(p.targetUrl)}">`,
    '<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;max-width:560px}a{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:12px;background:#0b6b3a;color:#fff;text-decoration:none}</style>',
    '</head>',
    '<body>',
    `<main><h1>${e(p.title)}</h1><p>${e(p.description)}</p><a href="${e(p.targetUrl)}" rel="noopener">${e(p.cta)}</a></main>`,
    '</body>',
    '</html>',
  ].join('\n');
}

const IP_RE = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * Rate-limit key. `cf-connecting-ip` (set by Cloudflare in front of the Edge runtime) wins.
 * Otherwise the client is the entry `trustedProxyHops` from the *right* of X-Forwarded-For:
 * entries to the left of what our own proxies appended are client-controlled and never trusted.
 */
export function clientIp(req: Request, trustedProxyHops = 1): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf && IP_RE.test(cf)) return cf;
  const hops = (req.headers.get('x-forwarded-for') ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const n = Math.max(1, Math.trunc(trustedProxyHops));
  const candidate = hops.length > 0 ? hops[Math.max(0, hops.length - n)] : undefined;
  return candidate && IP_RE.test(candidate) ? candidate : 'unknown';
}

export async function handle(req: Request, deps: InvitePreviewDeps): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const url = new URL(req.url);
  const locale = negotiateLocale(url.searchParams.get('lang'), req.headers.get('accept-language'));
  const token = tokenFrom(url);
  const vary = { vary: 'Accept-Language' };
  const send = (page: PreviewPage, status: number, cache: string): Response => {
    const res = html(renderPage(page), status, { ...vary, 'cache-control': cache });
    return req.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
  };

  const limit = await deps.rateLimiter.hit(`invite-preview:${clientIp(req, deps.trustedProxyHops)}`, 120, 60_000);
  if (!limit.allowed) {
    return new Response('Too many requests', { status: 429, headers: { 'retry-after': String(Math.ceil(limit.retryAfterMs / 1000)), 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (!token) return send(buildPage(null, null, locale, deps), 404, 'no-store');

  let preview: InvitePreview | null;
  try {
    preview = await deps.store.getInvitePreview(token);
  } catch (error) {
    deps.log.error('invite_preview.failed', { error });
    return send(buildPage(null, token, locale, deps), 503, 'no-store');
  }
  deps.log.info('invite_preview.served', { found: preview !== null, locale });
  if (!preview) return send(buildPage(null, token, locale, deps), 404, 'no-store');
  // Spots left changes: let link-preview caches refresh within minutes.
  return send(buildPage(preview, token, locale, deps), 200, 'public, max-age=300');
}

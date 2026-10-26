/**
 * Localised copy for the invite rich preview (PRD §5.4, GAME-030).
 *
 * The catalogs come from `@st/i18n` and are collected by `build-domain.mjs`
 * into `_shared/invite-copy.json` (per locale: `common:sports`, `games:invite`
 * and, when present, `invite:preview`). Missing keys fall back to English, then
 * to the built-in strings below, so a preview always renders. Day and time are
 * formatted with `Intl` in the game's time zone (no copy needed).
 */
import { DEFAULT_LOCALE, LOCALES, isLocale, type InvitePreview, type Locale } from '@st/domain';
import { formatIcu } from '#shared/i18n';

export interface InviteCatalog {
  sports?: Readonly<Record<string, string>>;
  /** `games:invite` */
  invite?: Readonly<Record<string, string>>;
  /** `invite:preview` (optional namespace) */
  preview?: Readonly<Record<string, string>>;
}
export type InviteCatalogs = Readonly<Partial<Record<Locale, InviteCatalog>>>;

/** Built-in English used when no catalog has the key. ICU syntax. */
export const INVITE_FALLBACK = {
  title: '{sport}: {title}',
  spotsLeft: '{count, plural, =0 {Full, join the waitlist} one {# spot left} other {# spots left}}',
  weekly: 'Every {weekday} at {time}',
  biweekly: 'Every other {weekday} at {time}',
  from: '{name} invited you to play',
  join: 'Join',
  womenOnly: 'Women only',
  expired: 'This invite has expired. Ask the host for a new link.',
  siteName: 'Sport Talent',
} as const;

export type InviteCopyKey = keyof typeof INVITE_FALLBACK;

/** Where each key lives in the catalogs (`games:invite.*` keys already exist; the rest are `invite:preview.*`). */
const KEY_SOURCE: Readonly<Record<InviteCopyKey, readonly ['invite' | 'preview', string]>> = {
  title: ['preview', 'title'],
  spotsLeft: ['preview', 'spotsLeft'],
  weekly: ['preview', 'weekly'],
  biweekly: ['preview', 'biweekly'],
  from: ['invite', 'from'],
  join: ['invite', 'join'],
  womenOnly: ['preview', 'womenOnly'],
  expired: ['invite', 'expired'],
  siteName: ['preview', 'siteName'],
};

const INTL_LOCALE: Readonly<Partial<Record<Locale, string>>> = { 'zh-Hans': 'zh-Hans-CN', 'zh-Hant': 'zh-Hant-TW' };
export const intlLocale = (l: Locale): string => INTL_LOCALE[l] ?? l;

/** Maps a BCP 47 tag to a supported locale (`iw` → he, `zh-TW` → zh-Hant, `pt-BR` → pt), or `null`. */
export function matchLocale(tag: string): Locale | null {
  const t = tag.trim();
  if (!t || t.length > 35 || !/^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/.test(t)) return null;
  const exact = LOCALES.find((l) => l.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const [lang = '', ...rest] = t.toLowerCase().split('-');
  if (lang === 'zh') {
    if (rest.includes('hant') || rest.some((r) => r === 'tw' || r === 'hk' || r === 'mo')) return 'zh-Hant';
    return 'zh-Hans';
  }
  const alias: Record<string, string> = { iw: 'he' };
  const base = alias[lang] ?? lang;
  return LOCALES.find((l) => l === base) ?? null;
}

/** `?lang=` wins, then `Accept-Language` (q-values honoured), then English. */
export function negotiateLocale(langParam: string | null, acceptLanguage: string | null): Locale {
  if (langParam) {
    const m = matchLocale(langParam);
    if (m) return m;
  }
  if (acceptLanguage) {
    const ranked = acceptLanguage
      .split(',')
      .slice(0, 20)
      .map((part, i) => {
        const [tag = '', ...params] = part.trim().split(';');
        const q = params.map((p) => /^\s*q=([01](?:\.\d{0,3})?)\s*$/.exec(p)).find(Boolean);
        return { tag: tag.trim(), q: q ? Number(q[1]) : 1, i };
      })
      .filter((x) => x.q > 0 && x.tag !== '*')
      .sort((a, b) => b.q - a.q || a.i - b.i);
    for (const r of ranked) {
      const m = matchLocale(r.tag);
      if (m) return m;
    }
  }
  return DEFAULT_LOCALE;
}

export interface InviteLocalizer {
  text(locale: Locale, key: InviteCopyKey, params?: Readonly<Record<string, string | number>>): string;
  sport(locale: Locale, sport: string): string;
}

export function createInviteLocalizer(catalogs: InviteCatalogs): InviteLocalizer {
  const pattern = (loc: Locale, key: InviteCopyKey): string | null => {
    const [ns, k] = KEY_SOURCE[key];
    const v = catalogs[loc]?.[ns]?.[k];
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  const tryFormat = (p: string | null, params: Readonly<Record<string, string | number>>, loc: Locale): string | null => {
    if (p === null) return null;
    try {
      return formatIcu(p, params, intlLocale(loc));
    } catch {
      return null;
    }
  };
  return {
    text(locale, key, params = {}) {
      const loc = isLocale(locale) ? locale : DEFAULT_LOCALE;
      return (
        tryFormat(pattern(loc, key), params, loc) ??
        tryFormat(pattern(DEFAULT_LOCALE, key), params, DEFAULT_LOCALE) ??
        (tryFormat(INVITE_FALLBACK[key], params, DEFAULT_LOCALE) as string)
      );
    },
    sport(locale, sport) {
      const v = catalogs[locale]?.sports?.[sport] ?? catalogs[DEFAULT_LOCALE]?.sports?.[sport];
      return typeof v === 'string' && v ? v : sport.charAt(0).toUpperCase() + sport.slice(1);
    },
  };
}

/** "Every Tuesday at 20:00" / "Tue, 10 Nov, 20:00" in the game's time zone, or `null`. */
export function formatWhen(preview: InvitePreview, locale: Locale, l10n: InviteLocalizer): string | null {
  const loc = intlLocale(locale);
  const tz = preview.timeZone ?? 'UTC';
  const safeTz = (() => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return tz;
    } catch {
      return 'UTC';
    }
  })();
  if (preview.recurrence && preview.weekday) {
    // 2024-01-01 was a Monday: pick the weekday name from a fixed reference date.
    const ref = new Date(Date.UTC(2024, 0, preview.weekday, 12));
    const weekday = new Intl.DateTimeFormat(loc, { weekday: 'long', timeZone: 'UTC' }).format(ref);
    let time = preview.localStartTime ?? '';
    const m = /^(\d{2}):(\d{2})$/.exec(time);
    if (m) time = new Intl.DateTimeFormat(loc, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, Number(m[1]), Number(m[2]))));
    return l10n.text(locale, preview.recurrence === 'biweekly' ? 'biweekly' : 'weekly', { weekday, time });
  }
  if (!preview.startsAt || Number.isNaN(Date.parse(preview.startsAt))) return null;
  // Without the game's time zone the time is shown in UTC and labelled as such, never silently shifted.
  return new Intl.DateTimeFormat(loc, {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: safeTz,
    ...(preview.timeZone && safeTz === preview.timeZone ? {} : { timeZoneName: 'short' as const }),
  }).format(new Date(preview.startsAt));
}

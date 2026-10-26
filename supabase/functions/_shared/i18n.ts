/**
 * Server-side rendering of notification copy (`notifications:<kind>.title|body`).
 *
 * Push payloads are rendered in the recipient's `profiles.locale`. The catalogs
 * come from `@st/i18n` (`packages/i18n/locales/<locale>/notifications.json`),
 * copied into `_shared/notifications.json` by `build-domain.mjs`. Missing
 * locales or keys fall back to English, then to a neutral generic text, so a
 * notification is never dropped for lack of a translation.
 *
 * The formatter implements the ICU MessageFormat subset our catalogs use:
 * `{arg}`, `{n, plural, =0 {…} one {…} other {…}}` with `#`, and
 * `{x, select, a {…} other {…}}`. Quotes/escapes are not used in the catalogs.
 */
import { DEFAULT_LOCALE, isLocale, type Locale, type NotificationKind, type NotificationParams } from '@st/domain';

export type NotificationCatalog = Readonly<Record<string, { title?: string; body?: string } | undefined>>;
export type NotificationCatalogs = Readonly<Partial<Record<Locale, NotificationCatalog>>>;

type Node = string | { arg: string; kind: 'simple' } | { arg: string; kind: 'plural' | 'select'; options: Record<string, Node[]> } | { kind: 'hash' };

function parse(src: string, pos: { i: number }, inPlural: boolean, depth = 0): Node[] {
  if (depth > 8) throw new Error('ICU nesting too deep');
  const out: Node[] = [];
  let buf = '';
  while (pos.i < src.length) {
    const ch = src[pos.i] as string;
    if (ch === '}') break;
    if (ch === '#' && inPlural) {
      if (buf) out.push(buf);
      buf = '';
      out.push({ kind: 'hash' });
      pos.i++;
      continue;
    }
    if (ch !== '{') {
      buf += ch;
      pos.i++;
      continue;
    }
    if (buf) out.push(buf);
    buf = '';
    pos.i++; // {
    const head = /^\s*([A-Za-z0-9_]+)\s*(?:,\s*(plural|select|selectordinal|number|date|time)\s*(?:,|(?=\})))?/.exec(src.slice(pos.i));
    if (!head) throw new Error('bad ICU argument');
    pos.i += head[0].length;
    const arg = head[1] as string;
    const kind = head[2];
    if (kind === 'plural' || kind === 'select' || kind === 'selectordinal') {
      const options: Record<string, Node[]> = {};
      for (;;) {
        const sel = /^\s*(=?[A-Za-z0-9_]+)\s*\{/.exec(src.slice(pos.i));
        if (!sel) break;
        pos.i += sel[0].length;
        options[sel[1] as string] = parse(src, pos, kind !== 'select', depth + 1);
        if (src[pos.i] !== '}') throw new Error('unterminated ICU option');
        pos.i++;
      }
      while (src[pos.i] === ' ') pos.i++;
      out.push({ arg, kind: kind === 'select' ? 'select' : 'plural', options });
    } else {
      out.push({ arg, kind: 'simple' });
    }
    if (src[pos.i] !== '}') throw new Error('unterminated ICU argument');
    pos.i++;
  }
  if (buf) out.push(buf);
  return out;
}

function render(nodes: Node[], params: NotificationParams, locale: string, hashValue: number | null): string {
  let s = '';
  for (const n of nodes) {
    if (typeof n === 'string') s += n;
    else if (n.kind === 'hash') s += hashValue === null ? '#' : new Intl.NumberFormat(locale).format(hashValue);
    else if (n.kind === 'simple') {
      const v = params[n.arg];
      s += v === undefined ? '' : typeof v === 'number' ? new Intl.NumberFormat(locale).format(v) : v;
    } else if (n.kind === 'select') {
      const v = String(params[n.arg] ?? 'other');
      s += render(n.options[v] ?? n.options['other'] ?? [], params, locale, hashValue);
    } else {
      const raw = params[n.arg];
      const v = typeof raw === 'number' ? raw : Number(raw);
      const exact = n.options[`=${v}`];
      const cat = Number.isFinite(v) ? new Intl.PluralRules(locale).select(v) : 'other';
      s += render(exact ?? n.options[cat] ?? n.options['other'] ?? [], params, locale, Number.isFinite(v) ? v : null);
    }
  }
  return s;
}

/** Formats an ICU message. Throws on malformed patterns. */
export function formatIcu(pattern: string, params: NotificationParams, locale: string): string {
  const pos = { i: 0 };
  const nodes = parse(pattern, pos, false);
  if (pos.i !== pattern.length) throw new Error('unbalanced ICU braces');
  return render(nodes, params, locale, null);
}

const INTL_LOCALE: Readonly<Partial<Record<Locale, string>>> = { 'zh-Hans': 'zh-Hans-CN', 'zh-Hant': 'zh-Hant-TW' };

/** Generic text used when no catalog has the key (never empty). */
const GENERIC = { title: 'Sport Talent', body: 'You have a new notification. Open the app to see it.' };

export interface Localizer {
  notification(locale: string | null, kind: NotificationKind, params: NotificationParams): { title: string; body: string; locale: Locale };
}

export function createLocalizer(catalogs: NotificationCatalogs): Localizer {
  const tryFormat = (loc: Locale, kind: NotificationKind, field: 'title' | 'body', params: NotificationParams): string | null => {
    const pattern = catalogs[loc]?.[kind]?.[field];
    if (typeof pattern !== 'string' || pattern.length === 0) return null;
    try {
      return formatIcu(pattern, params, INTL_LOCALE[loc] ?? loc);
    } catch {
      return null;
    }
  };
  return {
    notification(locale, kind, params) {
      const loc: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
      const title = tryFormat(loc, kind, 'title', params);
      const body = tryFormat(loc, kind, 'body', params);
      if (title !== null && body !== null) return { title, body, locale: loc };
      const enTitle = tryFormat(DEFAULT_LOCALE, kind, 'title', params);
      const enBody = tryFormat(DEFAULT_LOCALE, kind, 'body', params);
      return { title: enTitle ?? GENERIC.title, body: enBody ?? GENERIC.body, locale: DEFAULT_LOCALE };
    },
  };
}

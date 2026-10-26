import type { Locale } from '../types';

/**
 * Small, deliberately mild seed lists (insults, not slurs) used only for
 * instant client-side feedback (ADR 0005 layer 1; not trusted). Real lists are
 * curated and loaded server side; these exist to exercise the matcher in every
 * script. English terms are always checked in addition to the locale's list.
 */
export const SEED_BLOCKLISTS: Readonly<Record<Locale, readonly string[]>> = {
  en: ['idiot', 'moron', 'loser', 'stupid', 'shut up'],
  he: ['אידיוט', 'מטומטם', 'טמבל', 'סתום', 'לוזר'],
  ar: ['غبي', 'أحمق', 'حمار', 'اسكت', 'تافه'],
  es: ['idiota', 'estúpido', 'imbécil', 'tonto', 'cállate'],
  'zh-Hans': ['白痴', '笨蛋', '傻瓜', '滚开', '闭嘴'],
  'zh-Hant': ['白痴', '笨蛋', '傻瓜', '滾開', '閉嘴'],
  ja: ['馬鹿', 'アホ', '黙れ', 'うざい', 'クズ'],
  pt: ['idiota', 'estúpido', 'imbecil', 'otário', 'cala a boca'],
  ru: ['идиот', 'дурак', 'тупой', 'заткнись', 'придурок'],
  fr: ['idiot', 'imbécile', 'crétin', 'débile', 'ta gueule'],
  it: ['idiota', 'stupido', 'cretino', 'imbecille', 'stai zitto'],
  de: ['idiot', 'dummkopf', 'blödmann', 'trottel', 'halt die klappe'],
  hi: ['बेवकूफ', 'मूर्ख', 'पागल', 'गधा', 'चुप कर'],
};

/** Locales whose scripts have no word separators: terms match as substrings. */
export const SUBSTRING_LOCALES: readonly Locale[] = ['zh-Hans', 'zh-Hant', 'ja'];

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  LOCALES,
  SEED_BLOCKLISTS,
  combineModerationVerdicts,
  matchBlocklist,
  matchTerms,
  normalizeForMatch,
  type ModerationVerdict,
} from '../src';

describe('normalizeForMatch', () => {
  it('lower-cases, NFKC, strips diacritics/niqqud/tashkeel, collapses repeats, folds kana', () => {
    expect(normalizeForMatch('ＩＤＩＯＴ')).toBe('idiot');
    expect(normalizeForMatch('Estúpidooo!!', false)).toBe(normalizeForMatch('estupido'));
    expect(normalizeForMatch('אִידְיוֹט')).toBe('אידיוט');
    expect(normalizeForMatch('غَبِيّ')).toBe('غبي');
    expect(normalizeForMatch('غـــبي')).toBe('غبي');
    expect(normalizeForMatch('ёлка')).toBe('eлka');
    expect(normalizeForMatch('ばか')).toBe('バカ');
    expect(normalizeForMatch('  a​b  c ')).toBe('ab c');
    expect(normalizeForMatch('1d10t')).toBe('idiot');
    expect(normalizeForMatch('1d10t', false)).toBe('1d10t');
  });
});

describe('matchBlocklist', () => {
  it('every seed term matches itself in its locale (all 13 locales)', () => {
    for (const locale of LOCALES) {
      for (const term of SEED_BLOCKLISTS[locale]) {
        const r = matchBlocklist(`hey ${term} ok`, locale);
        expect(r.matched, `${locale}: ${term}`).toBe(true);
        expect(r.terms).toContain(term);
      }
    }
  });
  it('catches common evasions', () => {
    expect(matchBlocklist('you IDIOOOT', 'en').terms).toEqual(['idiot']);
    expect(matchBlocklist('you 1d10t', 'en').terms).toEqual(['idiot']);
    expect(matchBlocklist('i.d.i.o.t!', 'en').terms).toEqual(['idiot']);
    expect(matchBlocklist('i d i o t', 'en').terms).toEqual(['idiot']);
    expect(matchBlocklist('stupid!', 'en').terms).toEqual(['stupid']);
    expect(matchBlocklist('Shut   UP', 'en').terms).toEqual(['shut up']);
    expect(matchBlocklist('אִידְיוֹט', 'he').terms).toEqual(['אידיוט']);
    expect(matchBlocklist('你是白痴吗', 'zh-Hans').terms).toEqual(['白痴']);
    expect(matchBlocklist('ばか', 'ja').matched).toBe(false);
    expect(matchBlocklist('お前は馬鹿だ', 'ja').terms).toEqual(['馬鹿']);
    expect(matchBlocklist('ESTÚPIDO', 'es').terms).toEqual(['estúpido']);
    expect(matchBlocklist('idiot', 'de').terms).toEqual(['idiot']);
    expect(matchBlocklist('du idiot', 'fr').terms).toEqual(['idiot']);
  });
  it('does not match inside other words (space-delimited scripts)', () => {
    expect(matchBlocklist('a classic idiom', 'en').matched).toBe(false);
    expect(matchBlocklist('great pass, nice game', 'en')).toEqual({ matched: false, terms: [] });
    expect(matchBlocklist('', 'he').matched).toBe(false);
    expect(matchTerms('foo', ['', '  '])).toEqual({ matched: false, terms: [] });
  });
  it('property: never throws and is stable', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 80 }), fc.constantFrom(...LOCALES), (text, locale) => {
        expect(matchBlocklist(text, locale)).toEqual(matchBlocklist(text, locale));
      }),
    );
  });
});

describe('combineModerationVerdicts', () => {
  const v = (decision: ModerationVerdict['decision'], categories: ModerationVerdict['categories'] = [], source: ModerationVerdict['source'] = 'omni'): ModerationVerdict => ({
    decision,
    categories,
    source,
    reasonKey: null,
  });
  it('providers unavailable → pending (fail-open)', () => {
    expect(combineModerationVerdicts({ omni: 'timeout', llm: 'error' })).toEqual({ decision: 'pending', categories: [], source: 'fallback', reasonKey: null });
    expect(combineModerationVerdicts({ omni: v('pending'), blocklist: { matched: true, terms: ['x'] } })).toMatchObject({ decision: 'pending', categories: ['profanity'] });
    expect(combineModerationVerdicts({})).toMatchObject({ decision: 'pending' });
  });
  it('block rules', () => {
    expect(combineModerationVerdicts({ omni: v('block', ['threat']), llm: v('allow', [], 'llm') })).toEqual({
      decision: 'block',
      categories: ['threat'],
      source: 'combined',
      reasonKey: 'moderation.block.threat',
    });
    expect(combineModerationVerdicts({ omni: v('allow'), llm: v('block', ['harassment'], 'llm') })).toMatchObject({ decision: 'block', reasonKey: 'moderation.block.harassment' });
    expect(combineModerationVerdicts({ omni: v('block', ['harassment']), llm: 'timeout' })).toMatchObject({ decision: 'block', source: 'omni' });
    expect(combineModerationVerdicts({ llm: v('block', [], 'llm') })).toMatchObject({ decision: 'block', source: 'llm', reasonKey: 'moderation.block.other' });
    expect(combineModerationVerdicts({ omni: v('block', ['harassment', 'sexual_minors']), llm: v('block', ['harassment'], 'llm') })).toMatchObject({
      categories: ['sexual_minors', 'harassment'],
    });
  });
  it('omni-only non-severe block is downgraded to nudge when the LLM disagrees (sports slang)', () => {
    expect(combineModerationVerdicts({ omni: v('block', ['violence']), llm: v('allow', [], 'llm') }).decision).toBe('block');
    expect(combineModerationVerdicts({ omni: v('block', ['harassment']), llm: v('allow', [], 'llm') })).toMatchObject({ decision: 'nudge', reasonKey: 'moderation.nudge.harassment' });
  });
  it('nudge and allow', () => {
    expect(combineModerationVerdicts({ omni: v('allow'), llm: v('nudge', ['profanity'], 'llm') })).toMatchObject({ decision: 'nudge' });
    expect(combineModerationVerdicts({ omni: v('allow'), blocklist: { matched: true, terms: ['idiot'] } })).toMatchObject({ decision: 'nudge', categories: ['profanity'], source: 'combined' });
    expect(combineModerationVerdicts({ omni: v('allow'), llm: v('allow', [], 'llm'), blocklist: { matched: false, terms: [] } })).toEqual({
      decision: 'allow',
      categories: [],
      source: 'combined',
      reasonKey: null,
    });
  });
});

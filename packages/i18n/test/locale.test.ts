import { describe, expect, it } from 'vitest';
import { detectLocale, normalizeLocale } from '../src/locale';

describe('detectLocale', () => {
  it('maps Chinese variants to the right script', () => {
    expect(detectLocale(['zh-CN'])).toBe('zh-Hans');
    expect(detectLocale(['zh-SG'])).toBe('zh-Hans');
    expect(detectLocale(['zh-Hans'])).toBe('zh-Hans');
    expect(detectLocale(['zh-Hans-CN'])).toBe('zh-Hans');
    expect(detectLocale(['zh'])).toBe('zh-Hans');
    expect(detectLocale(['zh-TW'])).toBe('zh-Hant');
    expect(detectLocale(['zh-HK'])).toBe('zh-Hant');
    expect(detectLocale(['zh-MO'])).toBe('zh-Hant');
    expect(detectLocale(['zh-Hant'])).toBe('zh-Hant');
    expect(detectLocale(['zh-Hant-HK'])).toBe('zh-Hant');
    expect(detectLocale(['zh_TW'])).toBe('zh-Hant');
  });

  it('script wins over region', () => {
    expect(detectLocale(['zh-Hant-CN'])).toBe('zh-Hant');
    expect(detectLocale(['zh-Hans-TW'])).toBe('zh-Hans');
  });

  it('maps Portuguese regions to pt', () => {
    expect(detectLocale(['pt-BR'])).toBe('pt');
    expect(detectLocale(['pt-PT'])).toBe('pt');
    expect(detectLocale(['pt_BR'])).toBe('pt');
  });

  it('maps legacy and regional tags', () => {
    expect(detectLocale(['iw'])).toBe('he');
    expect(detectLocale(['iw-IL'])).toBe('he');
    expect(detectLocale(['he-IL'])).toBe('he');
    expect(detectLocale(['ar-EG'])).toBe('ar');
    expect(detectLocale(['en-GB'])).toBe('en');
    expect(detectLocale(['es-419'])).toBe('es');
    expect(detectLocale(['de-AT'])).toBe('de');
    expect(detectLocale(['hi-IN'])).toBe('hi');
    expect(detectLocale(['ja-JP'])).toBe('ja');
    expect(detectLocale(['RU-ru'])).toBe('ru');
    expect(detectLocale(['fr-CA-u-nu-latn'])).toBe('fr');
    expect(detectLocale(['yue-HK'])).toBe('zh-Hant');
  });

  it('uses the first supported language and falls back to en', () => {
    expect(detectLocale(['sv-SE', 'it-IT', 'de-DE'])).toBe('it');
    expect(detectLocale(['sv-SE', 'fi'])).toBe('en');
    expect(detectLocale([])).toBe('en');
    expect(detectLocale(['', '   ', 'xx'])).toBe('en');
  });

  it('normalizeLocale returns null for unsupported tags', () => {
    expect(normalizeLocale('sv')).toBeNull();
    expect(normalizeLocale('')).toBeNull();
    expect(normalizeLocale('en')).toBe('en');
  });
});

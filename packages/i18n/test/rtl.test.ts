import { describe, expect, it } from 'vitest';
import { LOCALES } from '@st/domain';
import { dir, isRTL, needsRestart } from '../src/rtl';

describe('rtl', () => {
  it('only Hebrew and Arabic are RTL', () => {
    expect(LOCALES.filter((l) => isRTL(l))).toEqual(['he', 'ar']);
    expect(dir('he')).toBe('rtl');
    expect(dir('ar')).toBe('rtl');
    expect(dir('en')).toBe('ltr');
    expect(dir('zh-Hant')).toBe('ltr');
  });

  it('needsRestart is true only when the direction changes', () => {
    expect(needsRestart(false, 'he')).toBe(true);
    expect(needsRestart(false, 'ar')).toBe(true);
    expect(needsRestart(true, 'en')).toBe(true);
    expect(needsRestart(true, 'hi')).toBe(true);
    expect(needsRestart(true, 'ar')).toBe(false);
    expect(needsRestart(true, 'he')).toBe(false);
    expect(needsRestart(false, 'de')).toBe(false);
    expect(needsRestart(false, 'zh-Hans')).toBe(false);
  });
});

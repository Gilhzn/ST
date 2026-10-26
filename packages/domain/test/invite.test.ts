import { describe, expect, it } from 'vitest';
import {
  LOCALES,
  SHARE_TEMPLATE_KEYS,
  buildShareMessage,
  computeMigrationStats,
  inviteUrl,
  shareTemplateKey,
  waMeUrl,
  type InvitePreview,
} from '../src';
import { U1, U2, U3, U4 } from './helpers';

const preview: InvitePreview = {
  sport: 'football',
  title: 'Tuesday 5-a-side',
  startsAt: '2026-10-27T20:00:00.000Z',
  timeZone: 'Asia/Jerusalem',
  recurrence: 'weekly',
  weekday: 2,
  localStartTime: '22:00',
  areaLabel: 'Florentin',
  spotsLeft: 3,
  capacity: 12,
  womenOnly: false,
  hostDisplayName: 'Dana',
  ogImageUrl: null,
};

describe('share message (PRD §5.4, 13 locales via keys)', () => {
  it('key + params, local date/time in the game zone', () => {
    const m = buildShareMessage(preview, 'he', 'https://sporttalent.app/invite/series/abc');
    expect(m).toEqual({
      key: 'invite:share.series.weekly',
      locale: 'he',
      url: 'https://sporttalent.app/invite/series/abc',
      params: {
        sport: 'football', title: 'Tuesday 5-a-side', host: 'Dana', url: 'https://sporttalent.app/invite/series/abc',
        hasDate: 'yes', date: '2026-10-27', time: '22:00', weekday: 2, hasArea: 'yes', area: 'Florentin', hasSpots: 'yes', spotsLeft: 3, capacity: 12,
      },
    });
  });
  it('variants and fallbacks', () => {
    expect(shareTemplateKey({ recurrence: null, womenOnly: false })).toBe('invite:share.game');
    expect(shareTemplateKey({ recurrence: null, womenOnly: true })).toBe('invite:share.gameWomenOnly');
    expect(shareTemplateKey({ recurrence: 'biweekly', womenOnly: true })).toBe('invite:share.seriesWomenOnly.biweekly');
    expect(SHARE_TEMPLATE_KEYS).toHaveLength(6);
    const m = buildShareMessage({ ...preview, startsAt: null, timeZone: null, areaLabel: null, spotsLeft: null, recurrence: 'biweekly', weekday: null, localStartTime: null }, 'xx', 'u');
    expect(m.locale).toBe('en');
    expect(m.params).toMatchObject({ hasDate: 'no', date: '', time: '', weekday: 0, hasArea: 'no', area: '', hasSpots: 'no', spotsLeft: 0 });
    for (const l of LOCALES) expect(buildShareMessage(preview, l, 'u').locale).toBe(l);
  });
  it('wa.me and invite URLs', () => {
    expect(waMeUrl('שחק איתנו! https://x.y/i?a=1&b=2')).toBe(`https://wa.me/?text=${encodeURIComponent('שחק איתנו! https://x.y/i?a=1&b=2')}`);
    expect(inviteUrl('https://sporttalent.app/', { kind: 'game' }, 'a b')).toBe('https://sporttalent.app/invite/a%20b');
    expect(inviteUrl('https://sporttalent.app', { kind: 'series' }, 'tok')).toBe('https://sporttalent.app/invite/series/tok');
  });
});

describe('migration stats', () => {
  it('joined from link, active since joining, roster and totals', () => {
    const target = { kind: 'series' as const, seriesId: 's1' };
    const s = computeMigrationStats(
      target,
      [
        { userId: U1, joinedVia: 'invite_link', joinedAt: '2026-10-02T00:00:00.000Z', current: true },
        { userId: U2, joinedVia: 'invite_link', joinedAt: '2026-10-01T00:00:00.000Z', current: false },
        { userId: U3, joinedVia: 'host', joinedAt: '2026-09-01T00:00:00.000Z', current: true },
        { userId: U4, joinedVia: 'played_with', joinedAt: '2026-09-01T00:00:00.000Z', current: true },
        { userId: U4, joinedVia: 'invite_link', joinedAt: '2026-10-05T00:00:00.000Z', current: true },
        { userId: U4, joinedVia: 'direct', joinedAt: '2026-10-06T00:00:00.000Z', current: true },
      ],
      [
        { userId: U1, at: '2026-10-03T00:00:00.000Z' },
        { userId: U2, at: '2026-09-03T00:00:00.000Z' },
        { userId: U3, at: '2026-10-03T00:00:00.000Z' },
      ],
    );
    expect(s).toEqual({ target, joinedFromLink: 3, activeFromLink: 1, rosterSize: 3, totalMembers: 4, firstJoinAt: '2026-10-01T00:00:00.000Z', lastJoinAt: '2026-10-05T00:00:00.000Z' });
    expect(computeMigrationStats(target, [], [])).toMatchObject({ joinedFromLink: 0, firstJoinAt: null, lastJoinAt: null });
  });
});

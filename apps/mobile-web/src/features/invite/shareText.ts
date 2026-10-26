/**
 * Renders a domain `ShareMessage` (i18n key from `SHARE_TEMPLATE_KEYS` + ICU params) into the
 * text people paste into WhatsApp. Raw params are made human here: the sport id becomes its
 * name, `weekday` (1–7) a weekday name, `date`/`time` local wall-clock labels. Shared text gets
 * no bidi isolates (they would travel into other apps as invisible characters).
 */
import type { ShareMessage, Weekday } from '@st/domain';
import { inviteUrl, type InviteTarget } from '@st/domain';
import { Platform } from 'react-native';

import type { TFunction } from '@/i18n';
import { localTimeLabel, weekdayName } from '@/features/series/format';

/** Origin of links shared from this device (the web app's own origin when running on web). */
export const SHARE_ORIGIN = Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://sporttalent.app';

export function linkFor(target: InviteTarget, token: string): string {
  return inviteUrl(SHARE_ORIGIN, target, token);
}

function longDate(date: string, locale: string): string {
  try {
    const [y, m, d] = date.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1, 12)));
  } catch {
    return date;
  }
}

export function renderShareMessage(message: ShareMessage, t: TFunction, locale: string, url?: string): string {
  const p = message.params;
  const weekday = Number(p.weekday ?? 0);
  return t(message.key, {
    ...p,
    sport: t(`common:sports.${String(p.sport)}`),
    url: url ?? message.url,
    date: p.hasDate === 'yes' && p.date ? longDate(String(p.date), locale) : '',
    time: p.time ? localTimeLabel(String(p.time), locale) : '',
    weekday: weekday >= 1 && weekday <= 7 ? weekdayName(weekday as Weekday, locale) : '',
    spotsLeft: Number(p.spotsLeft ?? 0),
    capacity: Number(p.capacity ?? 0),
  });
}

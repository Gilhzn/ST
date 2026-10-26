/**
 * Invite links and WhatsApp migration (PRD §5.4, GAME-030/031). WhatsApp has
 * no API for group members, so "import" is link based: the host shares a
 * localised message (i18n key + ICU params, rendered by the app in any of the
 * 13 locales), joiners land on the web join flow, enter the roster, and the
 * host sees how many moved.
 */
import {
  DEFAULT_LOCALE,
  isLocale,
  type InvitePreview,
  type InviteTarget,
  type IsoDateTime,
  type MigrationStats,
  type RosterJoinSource,
  type ShareMessage,
  type UserId,
} from '../types';
import { epochToZoned } from '../tz';
import { toEpochMs } from '../time';

/**
 * Share-message i18n keys (namespace `invite`). Every key gets the params of
 * {@link buildShareMessage}: `sport`, `title`, `host`, `url`, `hasDate`
 * (`yes|no`), `date` (`YYYY-MM-DD`, local), `time` (`HH:MM`, local), `weekday`
 * (1–7, ISO), `hasArea`, `area`, `hasSpots`, `spotsLeft`, `capacity`.
 */
export const SHARE_TEMPLATE_KEYS = [
  'invite:share.game',
  'invite:share.gameWomenOnly',
  'invite:share.series.weekly',
  'invite:share.series.biweekly',
  'invite:share.seriesWomenOnly.weekly',
  'invite:share.seriesWomenOnly.biweekly',
] as const;

export type ShareTemplateKey = (typeof SHARE_TEMPLATE_KEYS)[number];

/** The template for a preview: series (by cadence) or game, women-only variants. */
export function shareTemplateKey(preview: Pick<InvitePreview, 'recurrence' | 'womenOnly'>): ShareTemplateKey {
  if (preview.recurrence === null) return preview.womenOnly ? 'invite:share.gameWomenOnly' : 'invite:share.game';
  return `invite:share.${preview.womenOnly ? 'seriesWomenOnly' : 'series'}.${preview.recurrence}`;
}

/**
 * The localisable share message (never raw text). Date and time are local to
 * the game's time zone (falling back to the series' `localStartTime`); an
 * unsupported locale falls back to {@link DEFAULT_LOCALE}.
 */
export function buildShareMessage(preview: InvitePreview, locale: string, url: string): ShareMessage {
  const params: Record<string, string | number> = {
    sport: preview.sport,
    title: preview.title,
    host: preview.hostDisplayName,
    url,
    hasDate: 'no',
    date: '',
    time: preview.localStartTime ?? '',
    weekday: preview.weekday ?? 0,
    hasArea: preview.areaLabel ? 'yes' : 'no',
    area: preview.areaLabel ?? '',
    hasSpots: preview.spotsLeft === null ? 'no' : 'yes',
    spotsLeft: preview.spotsLeft ?? 0,
    capacity: preview.capacity,
  };
  if (preview.startsAt && preview.timeZone) {
    const local = epochToZoned(toEpochMs(preview.startsAt), preview.timeZone);
    params.hasDate = 'yes';
    params.date = local.date;
    params.time = local.time;
    params.weekday = local.weekday;
  }
  return { key: shareTemplateKey(preview), params, locale: isLocale(locale) ? locale : DEFAULT_LOCALE, url };
}

/** `https://wa.me/?text=<encoded>` (GAME-031). No phone number is ever included (GAME-033). */
export function waMeUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Public link: `<origin>/invite/<token>` for games, `<origin>/invite/series/<token>` for series. */
export function inviteUrl(origin: string, target: Pick<InviteTarget, 'kind'>, token: string): string {
  const base = origin.replace(/\/+$/, '');
  const t = encodeURIComponent(token);
  return target.kind === 'series' ? `${base}/invite/series/${t}` : `${base}/invite/${t}`;
}

/** One member of a series roster (or a game's participants) for migration stats. */
export interface MigrationMember {
  userId: UserId;
  /** `direct` for joins that did not come through a roster source (e.g. the map). */
  joinedVia: RosterJoinSource | 'direct';
  joinedAt: IsoDateTime;
  /** Still a regular / approved participant. */
  current: boolean;
}

/** PRD §5.4 step 5: how many of the group moved, and how many have actually played since. */
export function computeMigrationStats(
  target: InviteTarget,
  members: readonly MigrationMember[],
  verifiedAttendance: readonly { userId: UserId; at: IsoDateTime }[],
): MigrationStats {
  const byUser = new Map<UserId, MigrationMember>();
  for (const m of members) {
    const prev = byUser.get(m.userId);
    if (!prev || (m.joinedVia === 'invite_link' && prev.joinedVia !== 'invite_link')) byUser.set(m.userId, m);
  }
  const fromLink = [...byUser.values()].filter((m) => m.joinedVia === 'invite_link');
  const active = fromLink.filter((m) => verifiedAttendance.some((a) => a.userId === m.userId && toEpochMs(a.at) >= toEpochMs(m.joinedAt)));
  const joins = fromLink.map((m) => m.joinedAt).sort();
  return {
    target,
    joinedFromLink: fromLink.length,
    activeFromLink: active.length,
    rosterSize: [...byUser.values()].filter((m) => m.current).length,
    totalMembers: byUser.size,
    firstJoinAt: joins[0] ?? null,
    lastJoinAt: joins[joins.length - 1] ?? null,
  };
}

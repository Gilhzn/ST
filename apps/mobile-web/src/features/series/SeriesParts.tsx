/**
 * Recurring-series building blocks shared by the series screen, game details, the games tab
 * and the create wizard: the compact series card, a date tile, the "Part of a weekly series"
 * chip and the regulars-first banner.
 */
import type { GameSeries, SeriesOccurrence } from '@st/domain';
import { BidiText, Gradient, Haptics, Icon, isolate, radius, spacing, SportGlyphBadge, sportColors, StatusPill, Text, usePressScale, useTheme } from '@st/ui';
import { Animated, Pressable, View } from 'react-native';

import { Banner } from '@/components/States';
import { focusVisible } from '@/components/focusVisible';
import { useT } from '@/i18n';

import { cadenceLabel, shortDayTime } from './format';

/** Compact series card: sport gradient band (glyph, cadence, title) and a footer (regulars, next date, status). */
export function SeriesCard({
  series,
  nextLabel,
  regulars,
  status,
  onPress,
  testID,
  width,
}: {
  series: GameSeries;
  nextLabel?: string | null;
  regulars?: number | null;
  status?: { label: string; tone?: 'brand' | 'warning' | 'neutral' | 'success'; icon?: 'Sparkle' | 'Strategy' | 'CheckCircle' | 'Hourglass' | 'UserPlus' | 'StopCircle' } | null;
  onPress: () => void;
  testID?: string;
  width?: number;
}) {
  const { t, locale } = useT();
  const theme = useTheme();
  const press = usePressScale(0.985);
  const cadence = cadenceLabel(series, t, locale);
  const label = [t(`common:sports.${series.sport}`), series.title, cadence, nextLabel, status?.label].filter(Boolean).join('. ');
  return (
    <Animated.View style={[press.style, width ? { width } : null]}>
      <Pressable
        testID={testID}
        role="button"
        aria-label={label}
        onPress={() => {
          Haptics.selection();
          onPress();
        }}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={(st) => {
          const { focused } = st as { focused?: boolean };
          return {
            borderRadius: radius.lg,
            backgroundColor: theme.colors.surface,
            overflow: 'hidden',
            ...theme.elevation(theme.scheme === 'dark' ? 1 : 2),
            ...(focusVisible(focused) ? ({ outlineColor: theme.colors.focusRing, outlineWidth: 3, outlineStyle: 'solid', outlineOffset: 2 } as object) : null),
          };
        }}
      >
        <Gradient name={series.sport} style={{ padding: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm, overflow: 'hidden' }}>
          <View aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end', opacity: 0.16 }}>
            <View style={{ marginEnd: -18, marginBottom: -26 }}>
              <Icon name={sportColors[series.sport].phosphor} size={104} weight="fill" color="#FFFFFF" directional={false} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <SportGlyphBadge sport={series.sport} size={28} variant="glass" squircle />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
              <Icon name="Repeat" size={14} weight="bold" color="#FFFFFF" />
              <Text variant="caption" weight="semibold" color="textOnMedia" numberOfLines={1} style={{ opacity: 0.92, flexShrink: 1 }}>
                {cadence}
              </Text>
            </View>
          </View>
          <BidiText variant="title3" color="textOnMedia" numberOfLines={2}>
            {series.title}
          </BidiText>
        </Gradient>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingStart: spacing.lg, paddingEnd: spacing.md, paddingTop: spacing.sm + 2, paddingBottom: spacing.sm + 2 }}>
          <View style={{ flex: 1, gap: 2 }}>
            {nextLabel ? (
              <Text variant="footnote" weight="semibold" numberOfLines={1}>
                {nextLabel}
              </Text>
            ) : null}
            {regulars != null ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {t('series:regularsCount', { count: regulars })}
              </Text>
            ) : null}
          </View>
          {status ? <StatusPill label={status.label} tone={status.tone ?? 'neutral'} icon={status.icon} /> : <Icon name="CaretRight" size={18} weight="bold" color="textTertiary" />}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Calendar tile for a series date: weekday + big day number on the sport tint (muted when skipped). */
export function DateTile({ iso, sport, timeZone, muted }: { iso: string; sport: GameSeries['sport']; timeZone?: string; muted?: boolean }) {
  const { locale } = useT();
  const theme = useTheme();
  const s = theme.sport(sport);
  const fmt = (opts: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(locale, { ...opts, ...(timeZone ? { timeZone } : null) }).format(new Date(iso));
    } catch {
      return '';
    }
  };
  return (
    <View aria-hidden style={{ width: 48, height: 54, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: muted ? theme.colors.surfaceSunken : s.tint }}>
      <Text variant="caption" weight="semibold" allowFontScaling={false} style={{ color: muted ? theme.colors.textTertiary : s.text, lineHeight: 14 }} numberOfLines={1}>
        {fmt({ weekday: 'short' })}
      </Text>
      <Text variant="statSmall" allowFontScaling={false} style={{ color: muted ? theme.colors.textTertiary : s.text, fontSize: 20, lineHeight: 24 }}>
        {fmt({ day: 'numeric' })}
      </Text>
    </View>
  );
}

/** "Part of a weekly series · Every Thursday at 20:00" row on game details; opens the series. */
export function SeriesChip({ series, onPress }: { series: GameSeries; onPress: () => void }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const c = theme.colors;
  const title = t('series:chip', { recurrence: series.recurrence });
  const cadence = cadenceLabel(series, t, locale);
  return (
    <Pressable
      testID="game.series.chip"
      role="link"
      aria-label={`${title}. ${cadence}`}
      onPress={() => {
        Haptics.selection();
        onPress();
      }}
      style={(st) => {
        const { pressed, focused } = st as { pressed: boolean; focused?: boolean };
        return {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.md,
          paddingEnd: spacing.lg,
          borderRadius: radius.lg,
          backgroundColor: pressed ? c.surfaceSunken : c.surface,
          ...theme.elevation(1),
          ...(focusVisible(focused) ? ({ outlineColor: c.focusRing, outlineWidth: 3, outlineStyle: 'solid', outlineOffset: 2 } as object) : null),
        };
      }}
    >
      <View aria-hidden style={{ width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySubtle }}>
        <Icon name="Repeat" size={22} weight="bold" color="onPrimarySubtle" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="headline" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="footnote" color="textSecondary" numberOfLines={1}>
          {cadence}
        </Text>
      </View>
      <Icon name="CaretRight" size={18} weight="bold" color="textTertiary" />
    </Pressable>
  );
}

/** Regulars-first window notice (GAME-010): who may join now and until when. */
export function PriorityBanner({
  occurrence,
  timeZone,
  role,
  testID = 'game.priority.banner',
}: {
  occurrence: Pick<SeriesOccurrence, 'priorityUntil'>;
  timeZone?: string;
  role: 'host' | 'regular' | 'invited' | 'other';
  testID?: string;
}) {
  const { t, locale } = useT();
  const time = isolate(shortDayTime(occurrence.priorityUntil, locale, timeZone), 'ltr');
  const text =
    role === 'regular'
      ? t('series:priority.bannerRegular', { time })
      : role === 'host'
        ? t('series:priority.bannerHost', { time })
        : role === 'invited'
          ? t('series:priority.bannerInvited', { time })
          : t('series:priority.banner', { time });
  return <Banner testID={testID} tone="brand" icon="Hourglass" title={t('series:priority.title')} text={text} />;
}

import type { NearbyVenue } from '@st/domain';
import { BidiText, Card, Icon, isolate, spacing, SportGlyphBadge, Text, useTheme } from '@st/ui';
import { View } from 'react-native';

import { useT } from '@/i18n';
import { formatDistance, formatList, formatNumber } from '@/lib/format';

/**
 * Venue list card (design v2 §15.2/§15.3): stacked sport glyph wells, venue name, then
 * `MapPin` distance and a `Star` rating (warning color, never volt) as tabular numbers.
 */
export function VenueCard({ venue, onPress, testID, miles = false }: { venue: NearbyVenue; onPress?: () => void; testID?: string; miles?: boolean }) {
  const { t, locale } = useT();
  const { colors } = useTheme();
  const distance = formatDistance(venue.distanceM, locale, miles);
  const rating =
    venue.ratingAvg !== null
      ? t('games:venue.rating.summary', { rating: formatNumber(venue.ratingAvg, locale, { maximumFractionDigits: 1 }), count: venue.ratingCount })
      : t('games:venue.rating.none');
  const sports = formatList(venue.sports.map((s) => t(`common:sports.${s}`)), locale);
  return (
    <Card testID={testID} onPress={onPress} accessibilityLabel={formatList([venue.name, sports, t('map:card.distanceAway', { distance }), rating], locale)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View aria-hidden style={{ flexDirection: 'row' }}>
          {venue.sports.slice(0, 3).map((s, i) => (
            <SportGlyphBadge key={s} sport={s} size={40} variant="tint" squircle style={{ marginStart: i === 0 ? 0 : -12, zIndex: 3 - i, borderWidth: 2, borderColor: colors.surface }} />
          ))}
        </View>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <BidiText variant="headline" numberOfLines={2}>
            {venue.name}
          </BidiText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Icon name="MapPin" size={16} weight="fill" color="textTertiary" />
              <Text variant="footnote" weight="medium" color="textSecondary">
                {isolate(distance, 'ltr')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Icon name="Star" size={16} weight="fill" color={venue.ratingAvg !== null ? 'warning' : 'textTertiary'} />
              <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                {rating}
              </Text>
            </View>
          </View>
        </View>
        {onPress ? <Icon name="CaretRight" size={18} weight="bold" color="textTertiary" /> : null}
      </View>
    </Card>
  );
}

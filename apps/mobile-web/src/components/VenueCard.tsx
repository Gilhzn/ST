import type { NearbyVenue } from '@st/domain';
import { BidiText, Card, Row, SportDot, Stack, Text } from '@st/ui';

import { useT } from '@/i18n';
import { formatDistance, formatList, formatNumber } from '@/lib/format';

export function VenueCard({ venue, onPress, testID, miles = false }: { venue: NearbyVenue; onPress?: () => void; testID?: string; miles?: boolean }) {
  const { t, locale } = useT();
  const distance = formatDistance(venue.distanceM, locale, miles);
  const rating =
    venue.ratingAvg !== null
      ? t('games:venue.rating.summary', { rating: formatNumber(venue.ratingAvg, locale, { maximumFractionDigits: 1 }), count: venue.ratingCount })
      : t('games:venue.rating.none');
  const sports = formatList(venue.sports.map((s) => t(`common:sports.${s}`)), locale);
  return (
    <Card testID={testID} onPress={onPress} outlined accessibilityLabel={formatList([venue.name, sports, t('map:card.distanceAway', { distance }), rating], locale)}>
      <Stack gap="xs">
        <BidiText variant="bodyStrong" numberOfLines={2}>
          {venue.name}
        </BidiText>
        <Row gap="xs" wrap>
          {venue.sports.map((s) => (
            <SportDot key={s} sport={s} size={12} />
          ))}
          <Text variant="caption" color="textSecondary">
            {sports}
          </Text>
        </Row>
        <Row gap="md" wrap>
          <Text variant="caption" color="textSecondary">
            {t('map:card.distanceAway', { distance })}
          </Text>
          <Text variant="caption" color="textSecondary">
            {rating}
          </Text>
        </Row>
      </Stack>
    </Card>
  );
}

/**
 * Venue sheet (design §13.4): name, sports, distance, Directions, rating
 * summary, upcoming games here, start a game here, and a quiet
 * "No venue here? Report it." flow (one report per person).
 */
import { DEFAULT_TRUST_CONFIG, isStError, type NearbyGame, type NearbyVenue, type VenueReportReason } from '@st/domain';
import { BidiText, Button, Divider, Icon, IconButton, isolate, radius, Row, spacing, SportGlyphBadge, Stack, Text, useTheme } from '@st/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';

import { ChoiceChip } from '@/components/ChoiceChip';
import { GameCard } from '@/components/GameCard';
import { InlineError } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useAction } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { formatDistance, formatList, formatNumber } from '@/lib/format';

const REASONS: VenueReportReason[] = ['no_venue_here', 'wrong_location', 'closed', 'duplicate', 'unsafe', 'other'];

export function directionsUrl(lat: number, lng: number, label: string): string {
  const q = encodeURIComponent(label);
  if (Platform.OS === 'ios') return `maps:0,0?q=${q}&ll=${lat},${lng}`;
  if (Platform.OS === 'android') return `geo:${lat},${lng}?q=${lat},${lng}(${q})`;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

export function VenueDetails({
  venue,
  games,
  now,
  miles,
  onClose,
}: {
  venue: NearbyVenue;
  games: readonly NearbyGame[];
  now: number;
  miles: boolean;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const theme = useTheme();
  const port = useData();
  const toast = useToast();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<VenueReportReason | null>(null);
  const [reported, setReported] = useState(false);
  const report = useAction(async (r: VenueReportReason) => port.reportVenue(venue.id, r));
  const here = games.filter((g) => g.venueId === venue.id);
  const distance = formatDistance(venue.distanceM, locale, miles);

  const submitReport = async () => {
    if (!reason) return;
    const res = await report.run(reason);
    if (res || (report.error && isStError(report.error) && report.error.code === 'already_reported')) {
      setReported(true);
      setReporting(false);
      toast(t('games:venue.report.thanks', { count: DEFAULT_TRUST_CONFIG.venueReportsToHide }));
    }
  };
  const alreadyReported = reported || (report.error && isStError(report.error) && report.error.code === 'already_reported');

  const sportNames = formatList(venue.sports.map((sp) => t(`common:sports.${sp}`)), locale);
  const rating = venue.ratingAvg;

  return (
    <Stack gap="xl" testID="map.venue.sheet">
      <Stack gap="md">
        <Row gap="sm" align="center">
          <View aria-hidden style={{ flexDirection: 'row', flex: 1 }}>
            {venue.sports.slice(0, 4).map((sp, i) => (
              <SportGlyphBadge
                key={sp}
                sport={sp}
                size={44}
                variant="solid"
                squircle
                style={{ marginStart: i === 0 ? 0 : -10, zIndex: 4 - i, borderWidth: 2, borderColor: theme.colors.surfaceRaised }}
              />
            ))}
          </View>
          <IconButton testID="map.venue.close" icon="X" variant="tonal" label={t('common:actions.close')} onPress={onClose} />
        </Row>
        <Stack gap="xs">
          <BidiText variant="title2" role="heading" aria-level={2}>
            {venue.name}
          </BidiText>
          <Row gap="xs" align="center" wrap>
            <Icon name="MapPin" size={16} weight="fill" color="textTertiary" />
            <Text variant="callout" color="textSecondary">
              {formatList([sportNames, t('map:card.distanceAway', { distance: isolate(distance, 'ltr') })], locale)}
            </Text>
          </Row>
        </Stack>
      </Stack>

      <Row gap="sm" align="center">
        <View style={{ flex: 1 }}>
          <Button
            testID="map.venue.startGame"
            variant="primary"
            icon="Plus"
            fullWidth
            label={t('games:venue.startGame')}
            onPress={() => router.push({ pathname: '/game/create', params: { venueId: venue.id } })}
          />
        </View>
        <IconButton
          testID="map.venue.directions"
          icon="NavigationArrow"
          variant="tonal"
          size="lg"
          label={t('games:venue.directions')}
          onPress={() => void Linking.openURL(directionsUrl(venue.location.lat, venue.location.lng, venue.name))}
        />
      </Row>

      <View style={{ padding: spacing.lg, gap: spacing.xs, borderRadius: radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
        <Text variant="overline" color="textTertiary">
          {t('games:venue.rating.title')}
        </Text>
        {rating !== null ? (
          <Row gap="md" align="center">
            <Text variant="numeric" style={{ fontVariant: ['tabular-nums'] }}>
              {isolate(formatNumber(rating, locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }), 'ltr')}
            </Text>
            <Stack gap="xxs">
              <Row gap="xxs" aria-label={t('games:venue.rating.scoreOf5', { score: formatNumber(rating, locale, { maximumFractionDigits: 1 }) })} role="img">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Icon key={n} name="Star" size={16} weight={rating >= n - 0.25 ? 'fill' : 'regular'} color={rating >= n - 0.75 ? 'warning' : 'textTertiary'} />
                ))}
              </Row>
              <Text variant="footnote" color="textSecondary">
                {t('games:venue.rating.summary', { rating: formatNumber(rating, locale, { maximumFractionDigits: 1 }), count: venue.ratingCount })}
              </Text>
            </Stack>
          </Row>
        ) : (
          <Text variant="body" color="textSecondary">
            {t('games:venue.rating.none')}
          </Text>
        )}
        <Text variant="caption" color="textTertiary">
          {t('games:venue.rate.onlyAfterPlaying')}
        </Text>
      </View>

      <Stack gap="md">
        <Text variant="title3">{t('games:venue.upcoming')}</Text>
        {here.length ? (
          here.map((g) => (
            <GameCard key={g.id} game={g} distanceM={g.distanceM} now={now} miles={miles} testID={`map.venue.game.${g.id}`} onPress={() => router.push(`/game/${g.id}`)} />
          ))
        ) : (
          <Text variant="callout" color="textSecondary">
            {t('games:venue.noUpcoming')}
          </Text>
        )}
      </Stack>
      <Divider />
      {alreadyReported ? (
        <Text variant="callout" color="textSecondary" testID="map.venue.reported">
          {t('games:venue.report.done')}
        </Text>
      ) : reporting ? (
        <Stack gap="sm" testID="map.venue.reportForm">
          <Text variant="bodyStrong">{t('games:venue.report.title')}</Text>
          <Row gap="sm" wrap accessibilityRole="radiogroup">
            {REASONS.map((r) => (
              <ChoiceChip
                key={r}
                testID={`map.venue.report.reason.${r}`}
                label={t(`games:venue.report.reason.${r}`)}
                selectionRole="radio"
                selected={reason === r}
                onToggle={() => setReason(r)}
              />
            ))}
          </Row>
          {report.error && !alreadyReported ? <InlineError error={report.error} /> : null}
          <Row gap="sm">
            <Button testID="map.venue.report.submit" variant="danger" label={t('games:venue.report.submit')} disabled={!reason} loading={report.busy} onPress={submitReport} />
            <Button variant="ghost" label={t('common:actions.cancel')} onPress={() => setReporting(false)} />
          </Row>
        </Stack>
      ) : (
        <Button testID="map.venue.report" variant="ghost" icon="Flag" label={t('games:venue.report.cta')} onPress={() => setReporting(true)} style={{ alignSelf: 'center' }} />
      )}
    </Stack>
  );
}

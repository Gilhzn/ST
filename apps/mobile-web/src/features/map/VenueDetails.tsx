/**
 * Venue sheet (design §13.4): name, sports, distance, Directions, rating
 * summary, upcoming games here, start a game here, and a quiet
 * "No venue here? Report it." flow (one report per person).
 */
import { DEFAULT_TRUST_CONFIG, isStError, type NearbyGame, type NearbyVenue, type VenueReportReason } from '@st/domain';
import { BidiText, Button, Divider, Row, SportDot, Stack, Text } from '@st/ui';
import { ChoiceChip } from '@/components/ChoiceChip';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform } from 'react-native';

import { GameCard } from '@/components/GameCard';
import { InlineError } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useAction } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { formatDistance, formatNumber } from '@/lib/format';

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

  return (
    <Stack gap="lg" testID="map.venue.sheet">
      <Row gap="sm" align="start">
        <Stack gap="xs" style={{ flex: 1 }}>
          <BidiText variant="title2" accessibilityRole="header">
            {venue.name}
          </BidiText>
          <Row gap="xs" wrap>
            {venue.sports.map((s) => (
              <Row key={s} gap="xxs">
                <SportDot sport={s} />
                <Text variant="caption" color="textSecondary">
                  {t(`common:sports.${s}`)}
                </Text>
              </Row>
            ))}
          </Row>
          <Text variant="callout" color="textSecondary">
            {t('map:card.distanceAway', { distance })}
          </Text>
        </Stack>
        <Button testID="map.venue.close" variant="ghost" size="sm" label={t('common:actions.close')} onPress={onClose} />
      </Row>
      <Row gap="sm" wrap>
        <Button
          testID="map.venue.directions"
          variant="secondary"
          label={t('games:venue.directions')}
          onPress={() => void Linking.openURL(directionsUrl(venue.location.lat, venue.location.lng, venue.name))}
        />
        <Button
          testID="map.venue.startGame"
          variant="primary"
          label={t('games:venue.startGame')}
          onPress={() => router.push({ pathname: '/game/create', params: { venueId: venue.id } })}
        />
      </Row>
      <Stack gap="xs">
        <Text variant="title3">{t('games:venue.rating.title')}</Text>
        <Text variant="body" color="textSecondary">
          {venue.ratingAvg !== null
            ? t('games:venue.rating.summary', {
                rating: formatNumber(venue.ratingAvg, locale, { maximumFractionDigits: 1 }),
                count: venue.ratingCount,
              })
            : t('games:venue.rating.none')}
        </Text>
        <Text variant="caption" color="textTertiary">
          {t('games:venue.rate.onlyAfterPlaying')}
        </Text>
      </Stack>
      <Stack gap="sm">
        <Text variant="title3">{t('games:venue.upcoming')}</Text>
        {here.length ? (
          here.map((g) => (
            <GameCard key={g.id} game={g} distanceM={g.distanceM} now={now} miles={miles} testID={`map.venue.game.${g.id}`} onPress={() => router.push(`/game/${g.id}`)} />
          ))
        ) : (
          <Text variant="body" color="textSecondary">
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
        <Button testID="map.venue.report" variant="ghost" label={t('games:venue.report.cta')} onPress={() => setReporting(true)} />
      )}
    </Stack>
  );
}

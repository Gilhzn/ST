/**
 * Venue vault (VAULT-004/006): photos players chose to make public at this venue, every tagged
 * person having agreed. A date filter (this week / this month / all), a 3-column grid and a
 * simple viewer with the game date and a report action.
 */
import type { MediaItemView, VenueId } from '@st/domain';
import { Button, EmptyState, Haptics, radius, Segmented, spacing, Text, useTheme } from '@st/ui';
import { useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';

import { ChoiceChip } from '@/components/ChoiceChip';
import { focusVisible } from '@/components/focusVisible';
import { MediaImage } from '@/components/MediaImage';
import { Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { MEDIA_REPORT_REASONS, reportMedia, type MediaReportReason } from '@/data/extensions';
import { SheetModal } from '@/features/kit/SheetModal';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';

type Range = 'week' | 'month' | 'all';
const DAY = 86_400_000;

export function VenuePhotos({ venueId }: { venueId: VenueId }) {
  const { t, locale } = useT();
  const port = useData();
  const theme = useTheme();
  const [range, setRange] = useState<Range>('all');
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState<MediaItemView | null>(null);
  const from = range === 'all' ? undefined : new Date(Date.now() - (range === 'week' ? 7 : 31) * DAY).toISOString();
  const photos = useAsync(() => port.listVenueMedia(venueId, { from }), [port, venueId, range]);
  const tile = width ? Math.floor((width - 2 * 4) / 3) : 0;
  return (
    <View style={{ gap: spacing.md }} testID="venue.photos" onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <Segmented
        testID="venue.photos.range"
        size="sm"
        label={t('vault:venue.rangeA11y')}
        value={range}
        onChange={setRange}
        options={[
          { value: 'week', label: t('vault:venue.week'), testID: 'venue.photos.range.week' },
          { value: 'month', label: t('vault:venue.month'), testID: 'venue.photos.range.month' },
          { value: 'all', label: t('vault:venue.all'), testID: 'venue.photos.range.all' },
        ]}
      />
      {photos.loading && !photos.data ? (
        <Skeleton height={tile || 110} rows={1} />
      ) : (photos.data ?? []).length === 0 ? (
        <EmptyState testID="venue.photos.empty" illustration="success" illustrationSize={110} title={t('vault:venue.emptyTitle')} body={t('vault:venue.emptyBody')} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }} testID="venue.photos.grid">
            {(photos.data ?? []).map((m, i) => (
              <Pressable
                key={m.id}
                testID={`venue.photo.${i}`}
                role="button"
                aria-label={t('vault:venue.photoA11y', { date: formatDate(m.createdAt, locale, { day: 'numeric', month: 'long' }) })}
                onPress={() => {
                  Haptics.selection();
                  setOpen(m);
                }}
                style={(st) => {
                  const { focused } = st as { focused?: boolean };
                  return {
                    borderRadius: 12,
                    overflow: 'hidden',
                    ...(focusVisible(focused) ? ({ outlineColor: theme.colors.focusRing, outlineWidth: 3, outlineStyle: 'solid', outlineOffset: 2 } as object) : null),
                  };
                }}
              >
                <MediaImage uri={m.thumbnailUrl ?? m.url} width={tile} height={tile} />
              </Pressable>
            ))}
          </View>
          <Text variant="caption" color="textTertiary">
            {t('vault:venue.consent')}
          </Text>
        </>
      )}
      {open ? <PublicViewer item={open} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}

function PublicViewer({ item, onClose }: { item: MediaItemView; onClose: () => void }) {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<MediaReportReason | null>(null);
  const report = useAction((r: MediaReportReason) => reportMedia(port, item.id, r));
  return (
    <SheetModal visible testID="venue.photo.viewer" title={t('vault:viewer.title')} onClose={onClose} closeLabel={t('common:actions.close')} start={<Button variant="ghost" size="sm" label={t('common:actions.done')} onPress={onClose} />}>
      <MediaImage uri={item.url} width="100%" height={260} radius={radius.lg} label={t('vault:venue.photoA11y', { date: formatDate(item.createdAt, locale, { day: 'numeric', month: 'long' }) })} />
      <Text variant="callout" color="textSecondary">
        {t('vault:venue.sharedOn', { date: formatDate(item.createdAt, locale, { weekday: 'long', day: 'numeric', month: 'long' }) })}
      </Text>
      {reporting ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="headline">{t('vault:report.title')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} role="radiogroup">
            {MEDIA_REPORT_REASONS.map((r) => (
              <ChoiceChip key={r} selectionRole="radio" label={t(`vault:report.reason.${r}`)} selected={reason === r} onToggle={() => setReason(r)} />
            ))}
          </View>
          <Button
            variant="danger"
            label={t('vault:report.submit')}
            disabled={!reason}
            loading={report.busy}
            onPress={async () => {
              if (!reason) return;
              await report.run(reason);
              setReporting(false);
              toast(t('vault:report.thanks'), 'success');
            }}
            style={{ alignSelf: 'flex-start' }}
          />
        </View>
      ) : (
        <Button variant="ghost" icon="Flag" label={t('vault:report.cta')} onPress={() => setReporting(true)} style={{ alignSelf: 'flex-start' }} />
      )}
    </SheetModal>
  );
}

/** Sport chips (max 3, checkbox semantics) and the radius segmented control (radio semantics). */
import { MAX_SPORT_FILTERS, RADII_KM, SPORT_IDS, type RadiusKm, type SportId } from '@st/domain';
import { Chip, spacing } from '@st/ui';
import { ScrollView, View } from 'react-native';

import { useT } from '@/i18n';
import { formatKm } from '@/lib/format';

export function SportFilterBar({
  selected,
  onChange,
  onLimit,
}: {
  selected: readonly SportId[];
  onChange: (next: SportId[]) => void;
  onLimit: () => void;
}) {
  const { t } = useT();
  const atLimit = selected.length >= MAX_SPORT_FILTERS;
  const hint = t('map:filters.limitHint', { max: MAX_SPORT_FILTERS });
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm, paddingStart: spacing.lg, paddingEnd: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xs }}
      accessibilityLabel={t('map:filters.sports')}
      testID="map.filter.sports"
    >
      {SPORT_IDS.map((s) => {
        const on = selected.includes(s);
        const blocked = atLimit && !on;
        return (
          <View key={s} style={{ opacity: blocked ? 0.75 : 1 }}>
            <Chip
              testID={`map.filter.sport.${s}`}
              sport={s}
              label={t(`common:sports.${s}`)}
              selected={on}
              accessibilityHint={blocked ? hint : undefined}
              accessibilityState={{ checked: on, disabled: blocked }}
              onToggle={(next) => {
                if (next && blocked) {
                  onLimit();
                  return;
                }
                onChange(next ? [...selected, s] : selected.filter((x) => x !== s));
              }}
              style={blocked ? { borderStyle: 'dashed' } : undefined}
            />
          </View>
        );
      })}
    </ScrollView>
  );
}

export function RadiusSelector({ value, onChange, miles }: { value: RadiusKm; onChange: (r: RadiusKm) => void; miles: boolean }) {
  const { t, locale } = useT();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      testID="map.filter.radius"
      accessibilityRole="radiogroup"
      accessibilityLabel={t('map:radius.label')}
      contentContainerStyle={{ gap: spacing.sm, paddingStart: spacing.lg, paddingEnd: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xs }}
    >
      {RADII_KM.map((r) => {
        const distance = formatKm(r, locale, miles);
        return (
          <Chip
            key={r}
            testID={`map.filter.radius.${r}`}
            label={distance}
            accessibilityLabel={t('map:radius.a11y', { distance })}
            selectionRole="radio"
            selected={value === r}
            onToggle={() => onChange(r)}
          />
        );
      })}
    </ScrollView>
  );
}

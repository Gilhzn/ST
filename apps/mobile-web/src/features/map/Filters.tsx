/**
 * Map filters (design §13.3):
 * - `SportFilterBar`: horizontal rail of sport chips (Phosphor glyph + label), max 3 selected,
 *   checkbox semantics, haptic tick on toggle. At the limit the rest are disabled with a hint;
 *   a tap on a disabled chip lands on its wrapper, which explains the limit (toast + haptic).
 * - `RadiusSelector`: compact segmented control 1 · 2 · 5 · 10 · 30 · 50 (radio semantics);
 *   only the selected segment shows the unit. Miles locales show converted values.
 */
import { MAX_SPORT_FILTERS, RADII_KM, SPORT_IDS, type RadiusKm, type SportId } from '@st/domain';
import { Icon, sportColors, Text, useTheme } from '@st/ui';
import { Pressable, ScrollView, View } from 'react-native';

import { useT } from '@/i18n';
import { formatKm, formatNumber } from '@/lib/format';
import { GlyphIcon } from '@/platform/map/markers';

import { tick, warn } from './haptics';
import { useWeight } from './MapControls';

const CHIP_H = 38;

type SportTone = (typeof sportColors)[SportId] & { text?: string; textDark?: string; tint?: string; tintDark?: string };

export function SportFilterBar({
  selected,
  onChange,
  onLimit,
  inset = 16,
}: {
  selected: readonly SportId[];
  onChange: (next: SportId[]) => void;
  onLimit: () => void;
  inset?: number;
}) {
  const { t } = useT();
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const weight = useWeight();
  const atLimit = selected.length >= MAX_SPORT_FILTERS;
  const hint = t('map:filters.limitHint', { max: MAX_SPORT_FILTERS });
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingStart: inset, paddingEnd: inset, paddingTop: 6, paddingBottom: 10 }}
      accessibilityLabel={t('map:filters.sports')}
      testID="map.filter.sports"
    >
      {SPORT_IDS.map((s) => {
        const on = selected.includes(s);
        const blocked = atLimit && !on;
        const tone = sportColors[s] as SportTone;
        const label = t(`common:sports.${s}`);
        const iconColor = on ? tone.on : dark ? (tone.textDark ?? tone.color) : (tone.text ?? tone.color);
        return (
          // A blocked chip is disabled; the wrapper catches the attempt to show the limit toast.
          <Pressable
            key={s}
            accessible={false}
            focusable={false}
            onPress={
              blocked
                ? () => {
                    warn();
                    onLimit();
                  }
                : undefined
            }
            testID={`map.filter.sport.${s}.wrap`}
          >
            <Pressable
              testID={`map.filter.sport.${s}`}
              role="checkbox"
              aria-label={label}
              aria-checked={on}
              aria-disabled={blocked}
              accessibilityHint={blocked ? hint : undefined}
              disabled={blocked}
              hitSlop={{ top: 5, bottom: 5 }}
              onPress={() => {
                tick();
                onChange(on ? selected.filter((x) => x !== s) : [...selected, s]);
              }}
              style={({ pressed }) => ({
                height: CHIP_H,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingStart: 6,
                paddingEnd: on ? 10 : 14,
                borderRadius: CHIP_H / 2,
                backgroundColor: on ? tone.color : theme.colors.surface,
                borderWidth: 1,
                borderStyle: blocked ? 'dashed' : 'solid',
                borderColor: on ? 'transparent' : blocked ? theme.colors.borderStrong : dark ? 'rgba(255,255,255,0.08)' : 'rgba(18,17,41,0.06)',
                opacity: blocked ? 0.5 : 1,
                transform: pressed && !theme.reducedMotion ? [{ scale: 0.96 }] : undefined,
                boxShadow: on
                  ? `0px 4px 12px ${tone.color}55`
                  : dark
                    ? '0px 2px 8px rgba(0,0,0,0.4)'
                    : '0px 2px 8px rgba(18,17,41,0.10)',
              })}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: on ? 'rgba(255,255,255,0.22)' : dark ? (tone.tintDark ?? 'rgba(255,255,255,0.06)') : (tone.tint ?? theme.colors.surfaceSunken),
                }}
              >
                <Icon name={tone.phosphor} size={16} weight={on ? 'fill' : 'bold'} color={iconColor} />
              </View>
              <Text variant="label" style={[{ color: on ? tone.on : theme.colors.text }, weight('semibold')]} numberOfLines={1}>
                {label}
              </Text>
              {on ? <Icon name="Check" size={14} weight="bold" color={tone.on} /> : null}
            </Pressable>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function RadiusSelector({ value, onChange, miles }: { value: RadiusKm; onChange: (r: RadiusKm) => void; miles: boolean }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const weight = useWeight();
  return (
    <View
      testID="map.filter.radius"
      role="radiogroup"
      aria-label={t('map:radius.label')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        height: 40,
        padding: 3,
        gap: 2,
        borderRadius: 20,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(18,17,41,0.06)',
        boxShadow: dark ? '0px 2px 8px rgba(0,0,0,0.4)' : '0px 2px 8px rgba(18,17,41,0.10)',
      }}
    >
      <View style={{ paddingStart: 8, paddingEnd: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <GlyphIcon name="radar" size={16} color={theme.colors.textSecondary} />
      </View>
      {RADII_KM.map((r) => {
        const on = value === r;
        const distance = formatKm(r, locale, miles);
        const short = formatNumber(miles ? r * 0.621371 : r, locale, { maximumFractionDigits: miles && r < 10 ? 1 : 0 });
        return (
          <Pressable
            key={r}
            testID={`map.filter.radius.${r}`}
            role="radio"
            aria-checked={on}
            aria-label={t('map:radius.a11y', { distance })}
            hitSlop={{ top: 4, bottom: 4 }}
            onPress={() => {
              if (!on) tick();
              onChange(r);
            }}
            style={({ pressed }) => ({
              minWidth: 34,
              height: 34,
              paddingStart: on ? 10 : 6,
              paddingEnd: on ? 10 : 6,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? theme.colors.primary : pressed ? theme.colors.surfaceSunken : 'transparent',
              boxShadow: on ? `0px 3px 10px ${dark ? 'rgba(0,0,0,0.5)' : 'rgba(75,47,224,0.35)'}` : undefined,
            })}
          >
            <Text
              variant="label"
              style={[{ color: on ? theme.colors.onPrimary : theme.colors.textSecondary, fontVariant: ['tabular-nums'] }, weight(on ? 'bold' : 'semibold')]}
              numberOfLines={1}
            >
              {on ? distance : short}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Short profile after the age gate (design v2 §15.1): name, gender (optional), sports as large
 * glyph tiles, then per sport a card with position chips and a five-star level. One primary
 * "Finish setup" in the sticky footer (success haptic).
 */
import {
  SPORT_IDS,
  SPORT_POSITIONS,
  isLocale,
  type Gender,
  type PositionId,
  type SportId,
  type Stars,
  type UserSportInput,
} from '@st/domain';
import { Button, Card, Haptics, Icon, radius, spacing, SportGlyphBadge, Text, TextField, useTheme } from '@st/ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ChoiceChip } from '@/components/ChoiceChip';
import { Screen } from '@/components/Screen';
import { SportTile } from '@/components/SportTile';
import { InlineError } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { useAction } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { deviceRegion } from '@/lib/device';
import { getBirth, setBirth } from '@/state/onboardingDraft';
import { useSession } from '@/state/session';

const GENDERS: Gender[] = ['female', 'male', 'non_binary', 'undisclosed'];
const SKILLS: Stars[] = [1, 2, 3, 4, 5];

interface SportDraft {
  positions: PositionId[];
  skill: Stars;
}

export default function OnboardingScreen() {
  const { t, locale } = useT();
  const port = useData();
  const session = useSession();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [gender, setGender] = useState<Gender>('undisclosed');
  const [sports, setSports] = useState<Partial<Record<SportId, SportDraft>>>({});

  useEffect(() => {
    if (!getBirth()) router.replace('/age-gate');
  }, []);

  const finish = useAction(async () => {
    const birth = getBirth();
    if (!birth) throw new Error('age gate required');
    await port.createProfile({
      displayName: name.trim(),
      locale: isLocale(locale) ? locale : 'en',
      birthYear: birth.birthYear,
      birthMonth: birth.birthMonth,
      gender,
      countryCode: deviceRegion(),
    });
    const entries = Object.entries(sports) as [SportId, SportDraft][];
    if (entries.length) {
      await port.setMySports(
        entries.map(
          ([sport, d]) =>
            ({
              sport,
              selfSkill: d.skill,
              attributes: { speed: d.skill, control: d.skill, overall: d.skill },
              positions: d.positions,
            }) as UserSportInput,
        ),
      );
    }
    setBirth(null);
    await session.refresh();
  });

  const toggleSport = (sport: SportId, on: boolean) =>
    setSports((prev) => {
      const next = { ...prev };
      if (on) next[sport] = { positions: [], skill: 3 };
      else delete next[sport];
      return next;
    });

  const togglePosition = (sport: SportId, pos: PositionId, on: boolean) =>
    setSports((prev) => {
      const d = prev[sport];
      if (!d) return prev;
      return { ...prev, [sport]: { ...d, positions: on ? [...d.positions, pos] : d.positions.filter((p) => p !== pos) } };
    });

  const setSkill = (sport: SportId, skill: Stars) =>
    setSports((prev) => {
      const d = prev[sport];
      return d ? { ...prev, [sport]: { ...d, skill } } : prev;
    });

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 40) {
      setNameError(true);
      return;
    }
    void finish.run();
  };

  const chosen = SPORT_IDS.filter((s) => sports[s]);

  return (
    <Screen
      testID="screen.auth.onboarding"
      large
      title={t('auth:profileSetup.title')}
      subtitle={t('auth:profileSetup.subtitle')}
      backFallback="/age-gate"
      contentStyle={{ gap: spacing.xxl }}
      footer={
        <View style={{ gap: spacing.sm }}>
          <InlineError error={finish.error} />
          <Button testID="auth.onboarding.submit" label={t('auth:profileSetup.finish')} iconEnd="ArrowRight" loading={finish.busy} onPress={submit} fullWidth size="lg" haptic="publishGame" />
        </View>
      }
    >
      <View style={{ gap: spacing.lg }}>
        <TextField
          testID="auth.onboarding.name"
          label={t('auth:profileSetup.displayNameLabel')}
          helperText={t('auth:profileSetup.displayNameHint')}
          value={name}
          maxLength={40}
          icon="User"
          onChangeText={(v) => {
            setName(v);
            if (nameError) setNameError(false);
          }}
          autoComplete="name"
          textContentType="nickname"
          error={nameError ? t('common:validation.required') : undefined}
          required
        />
        <View style={{ gap: spacing.sm }}>
          <Text variant="label" color="textSecondary">
            {t('auth:profileSetup.genderLabel')}
          </Text>
          <View role="radiogroup" aria-label={t('auth:profileSetup.genderLabel')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {GENDERS.map((g) => (
              <ChoiceChip
                key={g}
                testID={`auth.onboarding.gender.${g}`}
                label={t(`auth:profileSetup.gender.${g}`)}
                selectionRole="radio"
                selected={gender === g}
                onToggle={() => setGender(g)}
              />
            ))}
          </View>
          <Text variant="footnote" color="textTertiary">
            {t('auth:profileSetup.genderHint')}
          </Text>
        </View>
      </View>

      <View style={{ gap: spacing.md }}>
        <View style={{ gap: spacing.xs }}>
          <Text variant="title2" role="heading" aria-level={2}>
            {t('auth:profileSetup.sportsTitle')}
          </Text>
          <Text variant="callout" color="textSecondary">
            {t('auth:profileSetup.sportsHint')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          {SPORT_IDS.map((s) => (
            <SportTile
              key={s}
              testID={`auth.onboarding.sport.${s}`}
              sport={s}
              label={t(`common:sports.${s}`)}
              selected={!!sports[s]}
              onPress={() => toggleSport(s, !sports[s])}
            />
          ))}
        </View>
      </View>

      {chosen.map((s) => {
        const d = sports[s] as SportDraft;
        const positions = SPORT_POSITIONS[s] as readonly PositionId[];
        return (
          <View key={s} testID={`auth.onboarding.sportCard.${s}`}>
            <Card padding="xl">
              <View style={{ gap: spacing.xl }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <SportGlyphBadge sport={s} size={40} variant="solid" squircle />
                  <Text variant="title3" style={{ flex: 1 }}>
                    {t(`common:sports.${s}`)}
                  </Text>
                </View>
                {positions.length ? (
                  <View style={{ gap: spacing.sm }}>
                    <Text variant="label" color="textSecondary">
                      {t('auth:profileSetup.positionsLabel')}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      {positions.map((p) => (
                        <ChoiceChip
                          key={p}
                          testID={`auth.onboarding.position.${s}.${p}`}
                          label={t(`common:positions.${p}`)}
                          selected={d.positions.includes(p)}
                          onToggle={(on) => togglePosition(s, p, on)}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
                <SkillStars
                  sport={s}
                  value={d.skill}
                  onChange={(n) => setSkill(s, n)}
                  label={t('auth:profileSetup.skillLabel')}
                  levelLabel={(n) => t(`auth:profileSetup.skill.${n}`)}
                />
              </View>
            </Card>
          </View>
        );
      })}
    </Screen>
  );
}

/**
 * Self-rated level as five large stars (radio semantics, 44dp targets, selection haptic) with
 * the level name beside them ("Intermediate"). Stars never mirror; order follows the reading
 * direction so "more" is always toward the end edge.
 */
function SkillStars({
  sport,
  value,
  onChange,
  label,
  levelLabel,
}: {
  sport: SportId;
  value: Stars;
  onChange: (n: Stars) => void;
  label: string;
  levelLabel: (n: Stars) => string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm }}>
        <Text variant="label" color="textSecondary">
          {label}
        </Text>
        <Text variant="label" weight="semibold" color="text" aria-live="polite">
          {levelLabel(value)}
        </Text>
      </View>
      <View role="radiogroup" aria-label={label} style={{ flexDirection: 'row', gap: spacing.xs }}>
        {SKILLS.map((n) => {
          const on = n <= value;
          return (
            <Pressable
              key={n}
              testID={`auth.onboarding.skill.${sport}.${n}`}
              role="radio"
              aria-checked={value === n}
              aria-label={levelLabel(n)}
              onPress={() => {
                Haptics.trigger('chipToggle');
                onChange(n);
              }}
              style={({ pressed }) => ({
                flex: 1,
                height: 48,
                maxWidth: 64,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: on ? colors.warningSubtle : colors.surfaceSunken,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Icon name="Star" size={24} weight={on ? 'fill' : 'regular'} color={on ? 'warning' : 'textTertiary'} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

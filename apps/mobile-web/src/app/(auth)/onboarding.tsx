/** Short profile after the age gate (design §13.2): name, gender (optional), sports with positions and self skill. */
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
import { BidiText, Button, Card, Row, Stack, Text, TextField } from '@st/ui';
import { ChoiceChip } from '@/components/ChoiceChip';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { SportIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
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

  return (
    <Screen testID="screen.auth.onboarding" title={t('auth:profileSetup.title')} backFallback="/age-gate">
      <Stack gap="xl">
        <Stack gap="xs">
          <TextField
            testID="auth.onboarding.name"
            label={t('auth:profileSetup.displayNameLabel')}
            helperText={t('auth:profileSetup.displayNameHint')}
            value={name}
            maxLength={40}
            onChangeText={(v) => {
              setName(v);
              if (nameError) setNameError(false);
            }}
            autoComplete="name"
            textContentType="nickname"
            error={nameError ? t('common:validation.required') : undefined}
            required
          />
          {name.trim() ? (
            <Text variant="caption" color="textSecondary">
              <BidiText variant="caption" color="textSecondary">
                {name.trim()}
              </BidiText>
            </Text>
          ) : null}
        </Stack>

        <Stack gap="sm">
          <Text variant="label">{t('auth:profileSetup.genderLabel')}</Text>
          <Text variant="caption" color="textTertiary">
            {t('auth:profileSetup.genderHint')}
          </Text>
          <Row gap="sm" wrap accessibilityRole="radiogroup">
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
          </Row>
        </Stack>

        <Stack gap="sm">
          <Text variant="title3">{t('auth:profileSetup.sportsTitle')}</Text>
          <Text variant="caption" color="textTertiary">
            {t('auth:profileSetup.sportsHint')}
          </Text>
          <Row gap="sm" wrap>
            {SPORT_IDS.map((s) => (
              <ChoiceChip
                key={s}
                testID={`auth.onboarding.sport.${s}`}
                sport={s}
                label={t(`common:sports.${s}`)}
                selected={!!sports[s]}
                onToggle={(on) => toggleSport(s, on)}
              />
            ))}
          </Row>
        </Stack>

        {SPORT_IDS.filter((s) => sports[s]).map((s) => {
          const d = sports[s] as SportDraft;
          const positions = SPORT_POSITIONS[s] as readonly PositionId[];
          return (
            <View key={s} testID={`auth.onboarding.sportCard.${s}`}>
            <Card outlined>
              <Stack gap="md">
                <Row gap="sm">
                  <SportIcon sport={s} />
                  <Text variant="title3">{t(`common:sports.${s}`)}</Text>
                </Row>
                {positions.length ? (
                  <Stack gap="xs">
                    <Text variant="label">{t('auth:profileSetup.positionsLabel')}</Text>
                    <Row gap="sm" wrap>
                      {positions.map((p) => (
                        <ChoiceChip
                          key={p}
                          testID={`auth.onboarding.position.${s}.${p}`}
                          label={t(`common:positions.${p}`)}
                          selected={d.positions.includes(p)}
                          onToggle={(on) => togglePosition(s, p, on)}
                        />
                      ))}
                    </Row>
                  </Stack>
                ) : null}
                <Stack gap="xs">
                  <Text variant="label">{t('auth:profileSetup.skillLabel')}</Text>
                  <Row gap="sm" wrap accessibilityRole="radiogroup">
                    {SKILLS.map((n) => (
                      <ChoiceChip
                        key={n}
                        testID={`auth.onboarding.skill.${s}.${n}`}
                        label={t(`auth:profileSetup.skill.${n}`)}
                        selectionRole="radio"
                        selected={d.skill === n}
                        onToggle={() => setSkill(s, n)}
                      />
                    ))}
                  </Row>
                </Stack>
              </Stack>
            </Card>
            </View>
          );
        })}

        <InlineError error={finish.error} />
        <Button testID="auth.onboarding.submit" label={t('auth:profileSetup.finish')} loading={finish.busy} onPress={submit} fullWidth size="lg" />
      </Stack>
    </Screen>
  );
}

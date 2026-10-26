/**
 * Edit profile as a sheet (design v2 §15.13): display name, bio, sports (sport chips) with
 * positions and a self-assessed level. Birth date and gender are not editable here.
 */
import {
  SPORT_IDS,
  SPORT_POSITIONS,
  type PositionId,
  type Profile,
  type SkillAttributes,
  type SportId,
  type Stars,
  type UserSport,
  type UserSportInput,
} from '@st/domain';
import { Avatar, Button, Chip, Row, spacing, SportGlyphBadge, Stack, Text, TextField, useTheme } from '@st/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { InlineError } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { SheetModal } from '@/features/kit/SheetModal';
import { useAction } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { useSession } from '@/state/session';

export const NAME_MAX = 40;
export const BIO_MAX = 280;
const SKILLS: Stars[] = [1, 2, 3, 4, 5];

interface SportDraft {
  positions: PositionId[];
  skill: Stars;
  attributes: SkillAttributes | null;
}

function draftFrom(sports: readonly UserSport[]): Partial<Record<SportId, SportDraft>> {
  const out: Partial<Record<SportId, SportDraft>> = {};
  for (const s of sports) out[s.sport] = { positions: [...(s.positions as readonly PositionId[])], skill: s.selfSkill, attributes: s.attributes };
  return out;
}

export function EditProfile({
  profile,
  sports,
  onDone,
  onCancel,
}: {
  profile: Profile;
  sports: readonly UserSport[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const theme = useTheme();
  const port = useData();
  const session = useSession();
  const toast = useToast();
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [nameError, setNameError] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<SportId, SportDraft>>>(() => draftFrom(sports));

  const save = useAction(async () => {
    await port.updateProfile({ displayName: name.trim(), bio: bio.trim() === '' ? null : bio.trim() });
    const entries = Object.entries(draft) as [SportId, SportDraft][];
    await port.setMySports(
      entries.map(
        ([sport, d]) =>
          ({
            sport,
            selfSkill: d.skill,
            attributes: d.attributes ? { ...d.attributes, overall: d.skill } : { speed: d.skill, control: d.skill, overall: d.skill },
            positions: d.positions,
          }) as UserSportInput,
      ),
    );
    await session.refresh();
    toast(t('profile:editForm.saved'));
    onDone();
  });

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
      setNameError(true);
      return;
    }
    void save.run();
  };

  const toggleSport = (sport: SportId, on: boolean) =>
    setDraft((prev) => {
      const next = { ...prev };
      if (on) next[sport] = prev[sport] ?? { positions: [], skill: 3, attributes: null };
      else delete next[sport];
      return next;
    });

  const togglePosition = (sport: SportId, pos: PositionId, on: boolean) =>
    setDraft((prev) => {
      const d = prev[sport];
      if (!d) return prev;
      return { ...prev, [sport]: { ...d, positions: on ? [...d.positions, pos] : d.positions.filter((p) => p !== pos) } };
    });

  const setSkill = (sport: SportId, skill: Stars) =>
    setDraft((prev) => {
      const d = prev[sport];
      return d ? { ...prev, [sport]: { ...d, skill } } : prev;
    });

  return (
    <SheetModal
      visible
      testID="screen.profile.edit"
      title={t('profile:editForm.title')}
      onClose={onCancel}
      closeLabel={t('common:actions.cancel')}
      start={<Button testID="profile.edit.cancel" variant="ghost" size="sm" label={t('common:actions.cancel')} onPress={onCancel} />}
      footer={<Button testID="profile.edit.save" label={t('common:actions.save')} icon="Check" loading={save.busy} onPress={submit} fullWidth size="lg" />}
    >
      <View style={{ alignItems: 'center' }}>
        <Avatar name={name.trim() || profile.displayName} uri={profile.avatarUrl} size="xl" decorative />
      </View>
      <Stack gap="xl">
        <TextField
          testID="profile.edit.name"
          label={t('profile:editForm.displayNameLabel')}
          value={name}
          maxLength={NAME_MAX}
          onChangeText={(v) => {
            setName(v);
            if (nameError) setNameError(false);
          }}
          autoComplete="name"
          inputDirection="auto"
          textContentType="nickname"
          error={nameError ? t('common:validation.required') : undefined}
          required
        />
        <Stack gap="xs">
          <TextField
            testID="profile.edit.bio"
            label={t('profile:editForm.bioLabel')}
            helperText={t('profile:editForm.bioHint')}
            value={bio}
            maxLength={BIO_MAX}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            inputDirection="auto"
            onChangeText={setBio}
          />
          <Text variant="caption" color="textTertiary" style={{ alignSelf: 'flex-end', fontVariant: ['tabular-nums'] }}>
            {t('trust:sanctions.appeal.counter', { count: bio.length, max: BIO_MAX })}
          </Text>
        </Stack>

        <Stack gap="sm">
          <Text variant="title3">{t('profile:sportsTitle')}</Text>
          <Text variant="caption" color="textTertiary">
            {t('auth:profileSetup.sportsHint')}
          </Text>
          <Row gap="sm" wrap>
            {SPORT_IDS.map((s) => (
              <Chip
                key={s}
                testID={`profile.edit.sport.${s}`}
                sport={s}
                label={t(`common:sports.${s}`)}
                selected={!!draft[s]}
                onToggle={(on) => toggleSport(s, on)}
              />
            ))}
          </Row>
        </Stack>

        {SPORT_IDS.filter((s) => draft[s]).map((s) => {
          const d = draft[s] as SportDraft;
          const positions = SPORT_POSITIONS[s] as readonly PositionId[];
          return (
            <View key={s} testID={`profile.edit.sportCard.${s}`}>
              <View style={{ padding: spacing.lg, borderRadius: 20, ...theme.elevation(1) }}>
                <Stack gap="md">
                  <Row gap="md">
                    <SportGlyphBadge sport={s} size={40} squircle />
                    <Text variant="title3">{t(`common:sports.${s}`)}</Text>
                  </Row>
                  {positions.length ? (
                    <Stack gap="xs">
                      <Text variant="label">{t('auth:profileSetup.positionsLabel')}</Text>
                      <Row gap="sm" wrap>
                        {positions.map((p) => (
                          <Chip
                            key={p}
                            testID={`profile.edit.position.${s}.${p}`}
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
                    <Row gap="sm" wrap role="radiogroup">
                      {SKILLS.map((n) => (
                        <Chip
                          key={n}
                          testID={`profile.edit.skill.${s}.${n}`}
                          label={t(`auth:profileSetup.skill.${n}`)}
                          selectionRole="radio"
                          selected={d.skill === n}
                          onToggle={() => setSkill(s, n)}
                        />
                      ))}
                    </Row>
                  </Stack>
                </Stack>
              </View>
            </View>
          );
        })}

        <InlineError error={save.error} />
      </Stack>
    </SheetModal>
  );
}

/**
 * Delete account (compliance §8, Apple 5.1.1(v), Play): two steps.
 *  1. Review: what is deleted, what is kept (pseudonymised) and what happens to games.
 *  2. Confirm: type the confirm word, then "Delete my account" (danger).
 * Deletion is never blocked by sanctions, deposits or upcoming games. On success the
 * session ends and the root gate returns to the phone screen.
 */
import { Button, Icon, isolate, radius, spacing, Stack, Text, TextField, useTheme, type IconName } from '@st/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { InlineError } from '@/components/States';
import { Notice } from '@/features/kit/Notice';
import { StepBar } from '@/features/kit/StepBar';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useAction } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { useSession } from '@/state/session';

/** Typed in Latin letters on every locale (design §13.14). */
export const CONFIRM_WORD = 'DELETE';

export function isConfirmWord(input: string): boolean {
  return input.trim().toUpperCase() === CONFIRM_WORD;
}

function Section({ title, children, testID, icon, danger, first }: { title: string; children: string; testID: string; icon: IconName; danger?: boolean; first?: boolean }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, borderTopWidth: first ? 0 : 1, borderTopColor: colors.border }}>
      <View aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? colors.dangerSubtle : colors.surfaceSunken }}>
        <Icon name={icon} size={20} weight="duotone" color={danger ? 'dangerText' : 'textSecondary'} />
      </View>
      <Stack gap="xxs" style={{ flex: 1 }}>
        <Text variant="headline">{title}</Text>
        <Text variant="callout" color="textSecondary">
          {children}
        </Text>
      </Stack>
    </View>
  );
}

export function DeleteAccountFlow() {
  const { t } = useT();
  const theme = useTheme();
  const port = useData();
  const session = useSession();
  const toast = useToast();
  const [step, setStep] = useState<'review' | 'confirm'>('review');
  const [typed, setTyped] = useState('');

  const remove = useAction(async () => {
    await port.deleteAccount();
    toast(t('settings:delete.done'));
    try {
      await session.signOut();
    } catch {
      // The server already ended the session; the auth listener returns to the phone screen.
    }
    router.replace('/phone');
  });

  if (step === 'review') {
    return (
      <Stack gap="xl" testID="settings.delete.review">
        <StepBar total={2} current={1} caption={t('settings:delete.step', { current: 1, total: 2 })} />
        <Notice tone="danger" icon="Trash" title={t('settings:delete.dangerZone')} text={t('settings:delete.intro')} live="assertive" />
        <View style={{ borderRadius: radius.lg, overflow: 'hidden', ...theme.elevation(1) }}>
          <Section first testID="settings.delete.deleted" icon="Trash" danger title={t('settings:delete.deletedTitle')}>
            {t('settings:delete.deleted')}
          </Section>
          <Section testID="settings.delete.kept" icon="ShieldCheck" title={t('settings:delete.keptTitle')}>
            {`${t('settings:delete.kept')}\n\n${t('settings:delete.keptMore')}`}
          </Section>
          <Section testID="settings.delete.games" icon="CalendarX" title={t('settings:delete.gamesTitle')}>
            {t('settings:delete.games')}
          </Section>
          <Section testID="settings.delete.timing" icon="Clock" title={t('settings:delete.timingTitle')}>
            {t('settings:delete.timing')}
          </Section>
        </View>
        <Text variant="footnote" color="textSecondary">
          {t('settings:delete.reregister')}
        </Text>
        <Stack gap="xs">
          <Button testID="settings.delete.continue" variant="outline" size="lg" fullWidth iconEnd="ArrowRight" label={t('common:actions.continue')} onPress={() => setStep('confirm')} />
          <Button testID="settings.delete.keep" variant="ghost" label={t('settings:delete.keep')} onPress={() => router.back()} />
        </Stack>
      </Stack>
    );
  }

  const ready = isConfirmWord(typed);
  return (
    <Stack gap="xl" testID="settings.delete.confirm">
      <StepBar total={2} current={2} caption={t('settings:delete.step', { current: 2, total: 2 })} />
      <Notice tone="danger" icon="WarningCircle" text={t('settings:delete.confirmIntro')} live="assertive" />
      <TextField
        testID="settings.delete.input"
        label={t('settings:delete.confirmTyped', { word: isolate(CONFIRM_WORD, 'ltr') })}
        value={typed}
        onChangeText={setTyped}
        inputDirection="ltr"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        editable={!remove.busy}
      />
      <InlineError error={remove.error} />
      <Button
        testID="settings.delete.submit"
        variant="danger"
        size="lg"
        fullWidth
        label={t('settings:delete.button')}
        loadingLabel={t('settings:delete.deleting')}
        loading={remove.busy}
        disabled={!ready || remove.busy}
        icon="Trash"
        haptic="destructiveConfirm"
        onPress={() => void remove.run()}
      />
      <Button testID="settings.delete.back" variant="ghost" label={t('common:actions.back')} disabled={remove.busy} onPress={() => setStep('review')} />
    </Stack>
  );
}

/**
 * Delete account (compliance §8, Apple 5.1.1(v), Play): two steps.
 *  1. Review: what is deleted, what is kept (pseudonymised) and what happens to games.
 *  2. Confirm: type the confirm word, then "Delete my account" (danger).
 * Deletion is never blocked by sanctions, deposits or upcoming games. On success the
 * session ends and the root gate returns to the phone screen.
 */
import { Button, Card, isolate, Stack, Text, TextField } from '@st/ui';
import { router } from 'expo-router';
import { useState } from 'react';

import { Icon } from '@/components/Icon';
import { InlineError } from '@/components/States';
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

function Section({ title, children, testID }: { title: string; children: string; testID: string }) {
  return (
    <Stack gap="xs" testID={testID}>
      <Text variant="title3">{title}</Text>
      <Text variant="body" color="textSecondary">
        {children}
      </Text>
    </Stack>
  );
}

export function DeleteAccountFlow() {
  const { t } = useT();
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
      <Stack gap="lg" testID="settings.delete.review">
        <Card outlined elevation={0} accessibilityRole="alert">
          <Stack gap="xs">
            <Text variant="title3" color="dangerText">
              {t('settings:delete.dangerZone')}
            </Text>
            <Text variant="body">{t('settings:delete.intro')}</Text>
          </Stack>
        </Card>
        <Section testID="settings.delete.deleted" title={t('settings:delete.deletedTitle')}>
          {t('settings:delete.deleted')}
        </Section>
        <Section testID="settings.delete.kept" title={t('settings:delete.keptTitle')}>
          {t('settings:delete.kept')}
        </Section>
        <Text variant="body" color="textSecondary">
          {t('settings:delete.keptMore')}
        </Text>
        <Section testID="settings.delete.games" title={t('settings:delete.gamesTitle')}>
          {t('settings:delete.games')}
        </Section>
        <Section testID="settings.delete.timing" title={t('settings:delete.timingTitle')}>
          {t('settings:delete.timing')}
        </Section>
        <Text variant="body" color="textSecondary">
          {t('settings:delete.reregister')}
        </Text>
        <Button testID="settings.delete.continue" variant="secondary" size="lg" fullWidth label={t('common:actions.continue')} onPress={() => setStep('confirm')} />
        <Button testID="settings.delete.keep" variant="ghost" label={t('settings:delete.keep')} onPress={() => router.back()} />
      </Stack>
    );
  }

  const ready = isConfirmWord(typed);
  return (
    <Stack gap="lg" testID="settings.delete.confirm">
      <Text variant="body">{t('settings:delete.confirmIntro')}</Text>
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
        startIcon={<Icon name="delete-outline" size={20} color="onDanger" />}
        onPress={() => void remove.run()}
      />
      <Button testID="settings.delete.back" variant="ghost" label={t('common:actions.back')} disabled={remove.busy} onPress={() => setStep('review')} />
    </Stack>
  );
}

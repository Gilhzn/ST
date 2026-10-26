/**
 * Result entry (design §13.10): open from the end of the game until
 * `resultWindowHours` after it, with a live countdown; score steppers per team
 * (48dp +/− and direct input); the score string stays LTR ("3–1"). Before the
 * game ends and after the window closes it is read-only.
 */
import { DEFAULT_TRUST_CONFIG, canSubmitResult } from '@st/domain';
import { BidiText, Button, isolate, Row, Stack, Text, TextField, useTheme } from '@st/ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';

import { Card } from '@/components/CardView';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Banner, ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { useGame } from '@/features/game/useGame';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatDuration, formatTime } from '@/lib/format';

const LETTERS = 'ABCDEFGHIJKLMNOP';
const DISPUTE_HOURS = 24;

export function ResultScreen({ gameId }: { gameId: string }) {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const now = useNow(30_000);
  const { game } = useGame(gameId, { participants: false });
  const existing = useAsync(() => port.getResult(gameId), [port, gameId]);
  const [scores, setScores] = useState<number[] | null>(null);
  const submit = useAction(async (s: number[]) => port.submitResult(gameId, s));

  const g = game.data;
  const teams = Math.max(1, g?.teamCount ?? 2);
  useEffect(() => {
    if (scores || !g || existing.loading) return;
    setScores(existing.data ? [...existing.data.teamScores] : Array.from({ length: teams }, () => 0));
  }, [g, existing.loading, existing.data, scores, teams]);

  if ((game.loading && !g) || !scores) {
    return (
      <Screen testID="screen.game.result" title={t('games:result.title')}>
        {game.error ? <ErrorView error={game.error} onRetry={() => void game.reload()} /> : <Skeleton rows={2} />}
      </Screen>
    );
  }
  if (!g) {
    return (
      <Screen testID="screen.game.result" title={t('games:result.title')}>
        <ErrorView error={game.error} onRetry={() => void game.reload()} />
      </Screen>
    );
  }

  const closesAt = new Date(Date.parse(g.endsAt) + DEFAULT_TRUST_CONFIG.resultWindowHours * 3600_000).toISOString();
  const open = canSubmitResult(g, now, DEFAULT_TRUST_CONFIG);
  const beforeEnd = now < Date.parse(g.endsAt);
  const allowed = g.isHost || g.myParticipation?.status === 'approved';
  const editable = open && allowed && !submit.busy;
  const teamName = (i: number) => t('games:teams.teamName', { letter: LETTERS[i] ?? String(i + 1) });
  const set = (i: number, v: number) => setScores((prev) => (prev ? prev.map((x, k) => (k === i ? Math.max(0, Math.min(999, v)) : x)) : prev));
  const minutesLeft = Math.max(1, Math.ceil((Date.parse(closesAt) - now) / 60_000));

  return (
    <Screen
      testID="screen.game.result"
      title={t('games:result.title')}
      backFallback={`/game/${gameId}`}
      footer={
        open && allowed ? (
          <Button
            testID="result.submit"
            size="lg"
            fullWidth
            label={t('games:result.submit')}
            loading={submit.busy}
            onPress={async () => {
              const r = await submit.run(scores);
              if (r) {
                toast(t('games:result.saved', { hours: DISPUTE_HOURS }));
                void existing.reload();
                router.back();
              }
            }}
          />
        ) : undefined
      }
    >
      <BidiText variant="callout" color="textSecondary">
        {g.title}
      </BidiText>
      {beforeEnd ? (
        <Banner testID="result.notYet" text={t('games:result.notYet', { time: isolate(formatTime(g.endsAt, locale), 'ltr') })} />
      ) : open ? (
        <Banner testID="result.window" tone="warning" text={t('games:result.window', { duration: formatDuration(minutesLeft, locale) })} />
      ) : (
        <Banner testID="result.closed" text={t('games:result.closed', { time: isolate(formatTime(closesAt, locale), 'ltr') })} />
      )}
      {!allowed ? <Banner tone="warning" text={t('errors:forbidden')} /> : null}
      {existing.data ? (
        <Text variant="callout" color="textSecondary" testID="result.current">
          {t('profile:history.result', { score: isolate(existing.data.teamScores.join('–'), 'ltr') })}
        </Text>
      ) : null}
      <Stack gap="md">
        {scores.map((score, i) => (
          <Card key={i} outlined testID={`result.team.${i}`}>
            <Row gap="md">
              <Text variant="title3" style={{ flex: 1 }}>
                {teamName(i)}
              </Text>
              <Stepper testID={`result.dec.${i}`} icon="minus" label={t('games:result.decrease', { team: teamName(i) })} disabled={!editable || score <= 0} onPress={() => set(i, score - 1)} />
              <TextField
                testID={`result.score.${i}`}
                label={t('games:result.scoreFor', { team: teamName(i) })}
                value={String(score)}
                editable={editable}
                keyboardType="number-pad"
                inputDirection="ltr"
                maxLength={3}
                onChangeText={(v) => set(i, Number(v.replace(/\D/g, '') || 0))}
                containerStyle={{ width: 96 }}
              />
              <Stepper testID={`result.inc.${i}`} icon="plus" label={t('games:result.increase', { team: teamName(i) })} disabled={!editable} onPress={() => set(i, score + 1)} />
            </Row>
          </Card>
        ))}
      </Stack>
      <Text variant="numeric" align="center" testID="result.preview" accessibilityLabel={scores.map((s, i) => `${teamName(i)} ${s}`).join(', ')}>
        {isolate(scores.join('–'), 'ltr')}
      </Text>
      <InlineError error={submit.error} />
    </Screen>
  );
}

function Stepper({ icon, label, onPress, disabled, testID }: { icon: 'plus' | 'minus'; label: string; onPress: () => void; disabled?: boolean; testID: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: colors.borderStrong,
        backgroundColor: disabled ? colors.disabledBg : pressed ? colors.surfaceSunken : colors.surface,
      })}
    >
      <Icon name={icon} color={disabled ? 'disabledText' : 'text'} />
    </Pressable>
  );
}

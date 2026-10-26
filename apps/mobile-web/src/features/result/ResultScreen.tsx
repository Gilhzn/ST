/**
 * Result entry (design v2 §15.10): open from the end of the game until `resultWindowHours`
 * after it. A scoreboard band shows the live score in big tabular numerals (one LTR isolate,
 * "3–1"); below, one stepper row per team (−/+ with a selection haptic, or type the number).
 * The window is a countdown ring. Before the game ends and after the window closes it is
 * read-only. Saving gives a success haptic and a toast.
 */
import { DEFAULT_TRUST_CONFIG, canSubmitResult } from '@st/domain';
import {
  BidiText,
  Button,
  Gradient,
  Haptics,
  IconButton,
  isolate,
  ProgressRing,
  radius,
  Row,
  Skeleton,
  spacing,
  Stack,
  Text,
  useTheme,
  type GradientName,
} from '@st/ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { ErrorView, InlineError } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { Notice } from '@/features/kit/Notice';
import { useGame } from '@/features/game/useGame';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatDuration, formatTime } from '@/lib/format';

const LETTERS = 'ABCDEFGHIJKLMNOP';
const DISPUTE_HOURS = 24;

export function ResultScreen({ gameId }: { gameId: string }) {
  const { t, locale } = useT();
  const theme = useTheme();
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

  if (!g || !scores) {
    return (
      <Screen testID="screen.game.result" title={t('games:result.title')} backFallback={`/game/${gameId}`}>
        {game.error && !g ? (
          <ErrorView error={game.error} onRetry={() => void game.reload()} />
        ) : (
          <Stack gap="lg" aria-busy testID="state.loading">
            <Skeleton height={72} radius={radius.lg} />
            <Skeleton height={180} radius={radius.xl} />
            <Skeleton height={140} radius={radius.lg} />
          </Stack>
        )}
      </Screen>
    );
  }

  const windowMin = DEFAULT_TRUST_CONFIG.resultWindowHours * 60;
  const closesAt = new Date(Date.parse(g.endsAt) + windowMin * 60_000).toISOString();
  const open = canSubmitResult(g, now, DEFAULT_TRUST_CONFIG);
  const beforeEnd = now < Date.parse(g.endsAt);
  const allowed = g.isHost || g.myParticipation?.status === 'approved';
  const editable = open && allowed && !submit.busy;
  const teamName = (i: number) => t('games:teams.teamName', { letter: LETTERS[i] ?? String(i + 1) });
  const set = (i: number, v: number) => setScores((prev) => (prev ? prev.map((x, k) => (k === i ? Math.max(0, Math.min(999, v)) : x)) : prev));
  const minutesLeft = Math.max(1, Math.ceil((Date.parse(closesAt) - now) / 60_000));
  const scoreText = scores.join('–');

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
            icon="Trophy"
            label={t('games:result.submit')}
            loading={submit.busy}
            haptic="none"
            onPress={async () => {
              const r = await submit.run(scores);
              if (r) {
                Haptics.trigger('resultSubmitted');
                toast(t('games:result.saved', { hours: DISPUTE_HOURS }));
                void existing.reload();
                router.back();
              } else Haptics.trigger('actionFailed');
            }}
          />
        ) : undefined
      }
    >
      <BidiText variant="callout" color="textSecondary" numberOfLines={1} style={{ marginTop: -spacing.md }}>
        {g.title}
      </BidiText>

      {beforeEnd ? (
        <Notice testID="result.notYet" tone="info" icon="Clock" text={t('games:result.notYet', { time: isolate(formatTime(g.endsAt, locale), 'ltr') })} />
      ) : open ? (
        <View testID="result.window" aria-live="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, paddingStart: spacing.lg, borderRadius: radius.lg, backgroundColor: theme.colors.infoSubtle }}>
          <ProgressRing progress={minutesLeft / windowMin} size={44} thickness={5} color="info" trackColor={theme.colors.surface} />
          <Stack gap="xxs" style={{ flex: 1 }}>
            <Text variant="headline" color="infoText">
              {t('games:result.window', { duration: formatDuration(minutesLeft, locale) })}
            </Text>
            <Text variant="footnote" color="textSecondary">
              {t('games:result.closesAt', { time: isolate(formatTime(closesAt, locale), 'ltr') })}
            </Text>
          </Stack>
        </View>
      ) : (
        <Notice testID="result.closed" tone="neutral" icon="LockSimple" text={t('games:result.closed', { time: isolate(formatTime(closesAt, locale), 'ltr') })} />
      )}
      {!allowed ? <Notice tone="warning" icon="LockSimple" text={t('errors:forbidden')} /> : null}

      {/* Scoreboard */}
      <Gradient name={g.sport as GradientName} style={{ borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md, overflow: 'hidden' }}>
        <Text variant="overline" align="center" style={{ color: 'rgba(255, 255, 255, 0.85)' }}>
          {t('games:result.finalScore')}
        </Text>
        {/* Scores are an LTR isolate ("3–1"), so the team badges keep LTR order to line up with them. */}
        <Row gap="md" justify="center" align="center" style={{ direction: 'ltr' }}>
          {teams === 2 ? <TeamBadge index={0} name={teamName(0)} /> : null}
          <Text
            testID="result.preview"
            variant="statLarge"
            color="textOnMedia"
            align="center"
            aria-label={scores.map((s, i) => `${teamName(i)} ${s}`).join(', ')}
            style={{ fontSize: scores.length > 2 ? 40 : 56, lineHeight: scores.length > 2 ? 48 : 64, flexShrink: 1 }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {isolate(scoreText, 'ltr')}
          </Text>
          {teams === 2 ? <TeamBadge index={1} name={teamName(1)} /> : null}
        </Row>
        {existing.data ? (
          <Text variant="footnote" align="center" testID="result.current" style={{ color: 'rgba(255, 255, 255, 0.85)' }}>
            {t('profile:history.result', { score: isolate(existing.data.teamScores.join('–'), 'ltr') })}
          </Text>
        ) : null}
      </Gradient>

      {/* Steppers */}
      <View style={{ borderRadius: radius.lg, overflow: 'hidden', ...theme.elevation(1) }}>
        {scores.map((score, i) => (
          <View
            key={i}
            testID={`result.team.${i}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              minHeight: 76,
              paddingStart: spacing.lg,
              paddingEnd: spacing.md,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: theme.colors.border,
            }}
          >
            <LetterWell index={i} sport={g.sport} />
            <Text variant="headline" style={{ flex: 1 }} numberOfLines={1}>
              {teamName(i)}
            </Text>
            <IconButton
              testID={`result.dec.${i}`}
              icon="Minus"
              variant="tonal"
              size="md"
              label={t('games:result.decrease', { team: teamName(i) })}
              disabled={!editable || score <= 0}
              haptic="scorePlusMinus"
              onPress={() => set(i, score - 1)}
            />
            <TextInput
              testID={`result.score.${i}`}
              aria-label={t('games:result.scoreFor', { team: teamName(i) })}
              value={String(score)}
              editable={editable}
              keyboardType="number-pad"
              maxLength={3}
              selectTextOnFocus
              onChangeText={(v) => set(i, Number(v.replace(/\D/g, '') || 0))}
              style={{
                width: 64,
                height: 52,
                borderRadius: radius.md,
                textAlign: 'center',
                writingDirection: 'ltr',
                backgroundColor: theme.colors.surfaceSunken,
                color: theme.colors.text,
                fontSize: 28,
                ...(theme.usesWeightedFamilies ? null : { fontWeight: '700' as const }),
                fontVariant: ['tabular-nums'],
                fontFamily: theme.fontFamily('bold'),
                ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
              }}
            />
            <IconButton
              testID={`result.inc.${i}`}
              icon="Plus"
              variant="tonal"
              size="md"
              label={t('games:result.increase', { team: teamName(i) })}
              disabled={!editable}
              haptic="scorePlusMinus"
              onPress={() => set(i, score + 1)}
            />
          </View>
        ))}
      </View>
      <InlineError error={submit.error} />
    </Screen>
  );
}

function TeamBadge({ index, name }: { index: number; name: string }) {
  return (
    <Stack gap="xs" align="center" style={{ width: 72 }}>
      <View aria-hidden style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.18)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)' }}>
        <Text variant="title3" weight="heavy" color="textOnMedia" allowFontScaling={false}>
          {LETTERS[index] ?? String(index + 1)}
        </Text>
      </View>
      <Text variant="caption" weight="semibold" color="textOnMedia" numberOfLines={1}>
        {name}
      </Text>
    </Stack>
  );
}

function LetterWell({ index, sport }: { index: number; sport: string }) {
  const theme = useTheme();
  const s = theme.sport(sport as never);
  const first = index % 2 === 0;
  return (
    <View aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: first ? s.tint : theme.colors.surfaceInverse }}>
      <Text variant="headline" weight="heavy" allowFontScaling={false} style={{ color: first ? s.text : theme.colors.textInverse }}>
        {LETTERS[index] ?? String(index + 1)}
      </Text>
    </View>
  );
}

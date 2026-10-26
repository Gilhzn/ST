/**
 * Result confirmation (GAME-071) and the game's rating status (GLK-003) on the result screen:
 * verified players confirm or dispute the submitted score (changeable until the window closes),
 * a tally shows the majority, and a calm notice says when a game will not count toward levels,
 * e.g. "Not rated: too few verified players".
 */
import { DEFAULT_PHASE15_CONFIG, type GameDetail, type GameNotRatedReason } from '@st/domain';
import { Button, Card, Haptics, Icon, ProgressRing, spacing, StatusPill, Text } from '@st/ui';
import { View } from 'react-native';

import { InlineError } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { Notice } from '@/features/kit/Notice';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { formatPercent } from '@/lib/format';

const SHOWN_REASONS: readonly GameNotRatedReason[] = ['too_few_verified', 'teams_not_published', 'not_two_sides', 'result_disputed', 'unrated_sport', 'result_not_confirmed'];

export function ResultConfirmation({ game, hasResult, now }: { game: GameDetail; hasResult: boolean; now: number }) {
  const { t, locale } = useT();
  const port = useData();
  const toast = useToast();
  const summary = useAsync(() => port.getResultConfirmation(game.id), [port, game.id, hasResult], hasResult);
  const status = useAsync(() => port.getGameRatingStatus(game.id), [port, game.id, hasResult, summary.data?.status]);
  const confirm = useAction((v: 'confirm' | 'dispute') => port.confirmResult(game.id, v));
  const s = summary.data;
  const verified = game.myParticipation?.status === 'approved' && game.myParticipation.attendance === 'verified';
  const closesAt = Date.parse(game.endsAt) + DEFAULT_PHASE15_CONFIG.peerRatingWindowHours * 3_600_000;
  const open = now >= Date.parse(game.endsAt) && now <= closesAt;
  const reason = status.data && !status.data.eligible ? status.data.reason : null;

  const onVerdict = async (v: 'confirm' | 'dispute') => {
    const res = await confirm.run(v);
    if (res) {
      Haptics.trigger(v === 'confirm' ? 'resultSubmitted' : 'destructiveConfirm');
      summary.setData(res);
      toast(v === 'confirm' ? t('ratings:confirm.thanks') : t('ratings:confirm.disputed'), v === 'confirm' ? 'success' : 'neutral');
      void status.reload();
    }
  };

  return (
    <View style={{ gap: spacing.lg }}>
      {hasResult && s ? (
        <Card padding="lg" testID="result.confirm">
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <ProgressRing
                progress={s.verifiedCount ? s.confirms / s.verifiedCount : 0}
                size={48}
                thickness={5}
                color={s.status === 'disputed' ? 'danger' : 'success'}
                label={t('ratings:confirm.tally', { confirms: s.confirms, count: s.verifiedCount })}
                valueText={t('ratings:confirm.tally', { confirms: s.confirms, count: s.verifiedCount })}
              >
                <Icon name={s.status === 'disputed' ? 'Flag' : 'CheckCircle'} size={20} weight="fill" color={s.status === 'disputed' ? 'dangerText' : 'successText'} />
              </ProgressRing>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="headline">{s.myVerdict || !verified ? t('ratings:confirm.statusTitle') : t('ratings:confirm.title')}</Text>
                <Text variant="footnote" color="textSecondary" testID="result.confirm.tally">
                  {t('ratings:confirm.tally', { confirms: s.confirms, count: s.verifiedCount })}
                  {s.disputes ? ` · ${t('ratings:confirm.disputes', { count: s.disputes })}` : ''}
                </Text>
              </View>
              <View testID="result.confirm.status">
                <StatusPill
                  tone={s.status === 'confirmed' ? 'success' : s.status === 'disputed' ? 'danger' : 'neutral'}
                  icon={s.status === 'confirmed' ? 'SealCheck' : s.status === 'disputed' ? 'Flag' : 'Hourglass'}
                  label={t(`ratings:confirm.status.${s.status}`)}
                />
              </View>
            </View>
            {verified && open ? (
              <>
                {s.myVerdict ? (
                  <Text variant="footnote" color="textSecondary" testID="result.confirm.mine">
                    {s.myVerdict === 'confirm' ? t('ratings:confirm.youConfirmed') : t('ratings:confirm.youDisputed')}
                  </Text>
                ) : (
                  <Text variant="footnote" color="textSecondary">
                    {t('ratings:confirm.help')}
                  </Text>
                )}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      testID="result.confirm.yes"
                      variant={s.myVerdict === 'confirm' ? 'secondary' : 'primary'}
                      icon="Check"
                      fullWidth
                      label={t('ratings:confirm.confirm')}
                      disabled={s.myVerdict === 'confirm'}
                      loading={confirm.busy}
                      haptic="none"
                      onPress={() => void onVerdict('confirm')}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      testID="result.confirm.no"
                      variant="outline"
                      icon="Flag"
                      fullWidth
                      label={t('ratings:confirm.dispute')}
                      disabled={s.myVerdict === 'dispute'}
                      haptic="none"
                      onPress={() => void onVerdict('dispute')}
                    />
                  </View>
                </View>
              </>
            ) : null}
            <InlineError error={confirm.error} />
          </View>
        </Card>
      ) : null}
      {reason && SHOWN_REASONS.includes(reason) && (hasResult || reason === 'unrated_sport') ? (
        <Notice
          testID="result.notRated"
          tone={reason === 'result_not_confirmed' ? 'info' : 'neutral'}
          icon={reason === 'result_not_confirmed' ? 'Hourglass' : 'ChartLineUp'}
          title={t(`ratings:notRated.${reason}`)}
          text={t(`ratings:notRatedHelp.${reason}`, { percent: formatPercent(DEFAULT_PHASE15_CONFIG.glickoMinVerifiedRatio, locale) })}
        />
      ) : null}
    </View>
  );
}

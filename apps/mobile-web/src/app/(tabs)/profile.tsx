/**
 * Profile (design §13.12): header, reliability card, stats, sports and positions,
 * sanctions in force and the edit flow. Edit is an in-screen mode (no extra route).
 */
import { Avatar, BidiText, Button, Row, Stack, Text } from '@st/ui';
import { router } from 'expo-router';
import { useState } from 'react';

import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { ErrorView, Skeleton } from '@/components/States';
import { Tag } from '@/components/Tag';
import { useData } from '@/data/DataProvider';
import { EditProfile } from '@/features/profile/EditProfile';
import { ReliabilityCard } from '@/features/profile/ReliabilityCard';
import { SanctionsList, sanctionsInForce } from '@/features/profile/SanctionsList';
import { SportsSection } from '@/features/profile/SportsSection';
import { StatsGrid } from '@/features/profile/StatsGrid';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { useSession } from '@/state/session';

export default function ProfileScreen() {
  const { t, locale } = useT();
  const port = useData();
  const { profile } = useSession();
  const now = useNow(60_000);
  const [editing, setEditing] = useState(false);
  const userId = profile?.id;
  const sports = useAsync(() => port.listUserSports(userId as string), [port, userId], !!userId);
  const sanctions = useAsync(() => port.listMySanctions(), [port, userId], !!userId);

  if (profile && editing) {
    return (
      <EditProfile
        profile={profile}
        sports={sports.data ?? []}
        onCancel={() => setEditing(false)}
        onDone={() => {
          setEditing(false);
          void sports.reload();
        }}
      />
    );
  }

  const inForce = sanctionsInForce(sanctions.data ?? [], now);
  return (
    <Screen
      title={t('profile:title')}
      back={false}
      testID="screen.profile"
      edges={['top']}
      headerEnd={
        <Button
          testID="profile.settings"
          variant="ghost"
          label={t('common:nav.settings')}
          startIcon={<Icon name="cog-outline" size={20} color="primaryText" />}
          onPress={() => router.push('/settings')}
        />
      }
    >
      {!profile ? (
        <Skeleton />
      ) : (
        <Stack gap="xl">
          <Row gap="md" align="start">
            <Avatar name={profile.displayName} uri={profile.avatarUrl} size="xl" decorative />
            <Stack gap="xs" style={{ flex: 1 }}>
              <BidiText variant="title2" testID="profile.name">
                {profile.displayName}
              </BidiText>
              <Text variant="caption" color="textSecondary">
                {t('profile:memberSince', { date: formatDate(profile.createdAt, locale, { month: 'short', year: 'numeric' }) })}
              </Text>
              {(sports.data ?? []).length > 0 ? (
                <Row gap="xs" wrap>
                  {(sports.data ?? []).map((s) => (
                    <Tag key={s.sport} label={t(`common:sports.${s.sport}`)} />
                  ))}
                </Row>
              ) : null}
            </Stack>
          </Row>
          {profile.bio ? (
            <BidiText variant="body" color="textSecondary" mode="block" testID="profile.bio">
              {profile.bio}
            </BidiText>
          ) : null}
          <Button
            testID="profile.edit"
            variant="secondary"
            label={t('profile:edit')}
            startIcon={<Icon name="pencil-outline" size={20} color="text" />}
            onPress={() => setEditing(true)}
            disabled={sports.loading && sports.data === undefined}
          />

          <ReliabilityCard reliability={profile.reliability} sanctions={sanctions.data ?? []} now={now} />
          <StatsGrid reliability={profile.reliability} />
          {sanctions.error && !sanctions.data ? <ErrorView error={sanctions.error} onRetry={() => void sanctions.reload()} /> : null}
          <SanctionsList sanctions={inForce} />
          {sports.error && !sports.data ? <ErrorView error={sports.error} onRetry={() => void sports.reload()} /> : <SportsSection sports={sports.data ?? []} />}
        </Stack>
      )}
    </Screen>
  );
}

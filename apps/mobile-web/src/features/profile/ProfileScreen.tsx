/**
 * Profile (design v2 §15.13): a night-stadium hero (avatar with ring, name, member since,
 * bio, sports as glass chips, settings and edit), the reliability card as the centrepiece
 * (overlapping the hero), a 2 × 2 stat grid, sanctions in force, and sports with positions
 * and level. Edit opens as a sheet.
 */
import { Avatar, BidiText, Gradient, Haptics, Icon, IconButton, radius, Row, Skeleton, spacing, SportGlyphBadge, Stack, Text, useTheme } from '@st/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorView } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { useSession } from '@/state/session';

import { EditProfile } from './EditProfile';
import { ReliabilityCard } from './ReliabilityCard';
import { SanctionsList, sanctionsInForce } from './SanctionsList';
import { SportsSection } from './SportsSection';
import { checkInStreak, StatsGrid } from './StatsGrid';

const ON_MEDIA_MUTED = 'rgba(255, 255, 255, 0.76)';

export function ProfileScreen() {
  const { t, locale } = useT();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const port = useData();
  const { profile } = useSession();
  const now = useNow(60_000);
  const [editing, setEditing] = useState(false);
  const userId = profile?.id;
  const sports = useAsync(() => port.listUserSports(userId as string), [port, userId], !!userId);
  const sanctions = useAsync(() => port.listMySanctions(), [port, userId], !!userId);
  const games = useAsync(() => port.listMyGames(), [port, userId], !!userId);

  const inForce = sanctionsInForce(sanctions.data ?? [], now);
  const streak = games.data ? checkInStreak(games.data, now) : null;

  return (
    <SafeAreaView testID="screen.profile" edges={[]} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl + insets.bottom }}>
        <Gradient name="brandNight" style={{ paddingTop: insets.top + spacing.xs, paddingBottom: spacing.xxxl + spacing.lg, borderBottomStartRadius: radius.xl, borderBottomEndRadius: radius.xl, overflow: 'hidden' }}>
          <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: -80, end: -60, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(143, 125, 255, 0.18)' }} />
          <View aria-hidden pointerEvents="none" style={{ position: 'absolute', bottom: -40, start: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(204, 255, 51, 0.07)' }} />
          <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingStart: spacing.lg, paddingEnd: spacing.sm, gap: spacing.lg }}>
            <Row style={{ minHeight: 52 }}>
              <Text variant="headline" color="textOnMedia" role="heading" style={{ flex: 1 }}>
                {t('profile:title')}
              </Text>
              <IconButton testID="profile.settings" icon="GearSix" label={t('common:nav.settings')} color="#FFFFFF" onPress={() => router.push('/settings')} />
            </Row>
            {!profile ? (
              <Row gap="lg" aria-busy>
                <Skeleton width={88} height={88} radius={44} />
                <Stack gap="sm" style={{ flex: 1 }}>
                  <Skeleton height={24} width="70%" />
                  <Skeleton height={14} width="50%" />
                </Stack>
              </Row>
            ) : (
              <Stack gap="lg" style={{ paddingEnd: spacing.sm }}>
                <Row gap="lg" align="center">
                  <Avatar name={profile.displayName} uri={profile.avatarUrl} size="xl" ring="rgba(255, 255, 255, 0.9)" decorative />
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <BidiText variant="title1" color="textOnMedia" testID="profile.name" numberOfLines={2}>
                      {profile.displayName}
                    </BidiText>
                    <Text variant="footnote" style={{ color: ON_MEDIA_MUTED }}>
                      {t('profile:memberSince', { date: formatDate(profile.createdAt, locale, { month: 'short', year: 'numeric' }) })}
                    </Text>
                  </Stack>
                </Row>
                {profile.bio ? (
                  <BidiText variant="callout" mode="block" testID="profile.bio" style={{ color: 'rgba(255, 255, 255, 0.88)' }}>
                    {profile.bio}
                  </BidiText>
                ) : null}
                <Row gap="sm" wrap>
                  {(sports.data ?? []).map((s) => (
                    <View
                      key={s.sport}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.xs + 2,
                        height: 32,
                        paddingStart: 4,
                        paddingEnd: spacing.md,
                        borderRadius: radius.pill,
                        backgroundColor: 'rgba(255, 255, 255, 0.12)',
                        borderWidth: 1,
                        borderColor: 'rgba(255, 255, 255, 0.2)',
                      }}
                    >
                      <SportGlyphBadge sport={s.sport} size={24} variant="solid" />
                      <Text variant="footnote" weight="semibold" color="textOnMedia">
                        {t(`common:sports.${s.sport}`)}
                      </Text>
                    </View>
                  ))}
                  <Pressable
                    testID="profile.edit"
                    role="button"
                    aria-label={t('profile:edit')}
                    aria-disabled={sports.loading && sports.data === undefined}
                    disabled={sports.loading && sports.data === undefined}
                    onPress={() => {
                      Haptics.light();
                      setEditing(true);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.xs + 2,
                      height: 32,
                      paddingStart: spacing.md,
                      paddingEnd: spacing.md,
                      borderRadius: radius.pill,
                      backgroundColor: pressed ? 'rgba(255, 255, 255, 0.32)' : 'rgba(255, 255, 255, 0.92)',
                    })}
                  >
                    <Icon name="PencilSimple" size={16} weight="bold" color="#121129" />
                    <Text variant="footnote" weight="semibold" style={{ color: '#121129' }}>
                      {t('profile:edit')}
                    </Text>
                  </Pressable>
                </Row>
              </Stack>
            )}
          </View>
        </Gradient>

        <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', marginTop: -(spacing.xxxl), paddingStart: spacing.lg, paddingEnd: spacing.lg, gap: spacing.xl }}>
          {profile ? (
            <>
              <ReliabilityCard reliability={profile.reliability} sanctions={sanctions.data ?? []} now={now} />
              <StatsGrid reliability={profile.reliability} streak={streak} />
              {sanctions.error && !sanctions.data ? <ErrorView error={sanctions.error} onRetry={() => void sanctions.reload()} /> : null}
              <SanctionsList sanctions={inForce} />
              {sports.error && !sports.data ? <ErrorView error={sports.error} onRetry={() => void sports.reload()} /> : <SportsSection sports={sports.data ?? []} />}
            </>
          ) : (
            <Stack gap="lg" aria-busy testID="state.loading">
              <Skeleton height={220} radius={radius.xl} />
              <Skeleton height={200} radius={radius.lg} />
            </Stack>
          )}
        </View>
      </ScrollView>
      {profile && editing ? (
        <EditProfile
          profile={profile}
          sports={sports.data ?? []}
          onCancel={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            void sports.reload();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

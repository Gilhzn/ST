/** Profile (design §13.12). Header + reliability now; stats/history next wave. */
import { Avatar, BidiText, Button, Card, Row, Stack, Text } from '@st/ui';
import { router } from 'expo-router';
import { View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ReliabilityBadge } from '@/components/ReliabilityBadge';
import { Screen } from '@/components/Screen';
import { useT } from '@/i18n';
import { useSession } from '@/state/session';

export default function ProfileScreen() {
  const { t } = useT();
  const { profile } = useSession();
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
      {profile ? (
        <Stack gap="lg">
          <Row gap="md">
            <Avatar name={profile.displayName} uri={profile.avatarUrl} size="xl" decorative />
            <Stack gap="xs" style={{ flex: 1 }}>
              <BidiText variant="title2">{profile.displayName}</BidiText>
              <ReliabilityBadge status={profile.reliability.status} score={profile.reliability.score} size="md" />
            </Stack>
          </Row>
          <View testID="profile.reliability">
          <Card accessibilityLabel={t('profile:reliabilityCard.a11y')}>
            <Stack gap="sm">
              <Text variant="title3">{t('trust:reliability.title')}</Text>
              <Text variant="body" color="textSecondary">
                {profile.reliability.status === 'new'
                  ? t('trust:reliability.newPlayer', { games: 3 })
                  : t('trust:reliability.basedOn', {
                      days: 90,
                      games: Math.round(profile.reliability.commitmentCount),
                      checkIns: profile.reliability.verifiedCount,
                      lateCancels: profile.reliability.lateCancelCount,
                    })}
              </Text>
            </Stack>
          </Card>
          </View>
        </Stack>
      ) : null}
    </Screen>
  );
}

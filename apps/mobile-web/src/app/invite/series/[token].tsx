import { useLocalSearchParams } from 'expo-router';

import { SeriesInviteLanding } from '@/features/invite/SeriesInviteLanding';

/** `/invite/series/<token>`: the series link a host shares with their WhatsApp group. */
export default function SeriesInviteRoute() {
  const { token, join } = useLocalSearchParams<{ token: string; join?: string }>();
  return <SeriesInviteLanding key={String(token)} token={String(token)} autoJoin={join === '1'} />;
}

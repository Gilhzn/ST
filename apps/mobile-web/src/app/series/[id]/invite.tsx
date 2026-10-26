import { useLocalSearchParams } from 'expo-router';

import { InviteGroupScreen } from '@/features/invite/InviteGroupScreen';

export default function SeriesInviteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <InviteGroupScreen key={String(id)} target={{ kind: 'series', seriesId: String(id) }} />;
}

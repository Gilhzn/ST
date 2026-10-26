import { useLocalSearchParams } from 'expo-router';

import { InviteGroupScreen } from '@/features/invite/InviteGroupScreen';

export default function GameInviteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <InviteGroupScreen key={String(id)} target={{ kind: 'game', gameId: String(id) }} />;
}

import { useLocalSearchParams } from 'expo-router';

import { TeamsScreen } from '@/features/teams/TeamsScreen';

export default function GameRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TeamsScreen key={String(id)} gameId={String(id)} />;
}

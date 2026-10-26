import { useLocalSearchParams } from 'expo-router';

import { CheckInScreen } from '@/features/checkin/CheckInScreen';

export default function GameRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CheckInScreen key={String(id)} gameId={String(id)} />;
}

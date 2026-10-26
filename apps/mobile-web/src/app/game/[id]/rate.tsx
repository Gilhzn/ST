import { useLocalSearchParams } from 'expo-router';

import { RateScreen } from '@/features/ratings/RateScreen';

export default function RateRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RateScreen key={String(id)} gameId={String(id)} />;
}

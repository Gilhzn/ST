import { useLocalSearchParams } from 'expo-router';

import { ResultScreen } from '@/features/result/ResultScreen';

export default function GameRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ResultScreen key={String(id)} gameId={String(id)} />;
}

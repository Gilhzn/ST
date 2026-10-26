import { useLocalSearchParams } from 'expo-router';

import { SeriesScreen } from '@/features/series/SeriesScreen';

export default function SeriesRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SeriesScreen key={String(id)} seriesId={String(id)} />;
}

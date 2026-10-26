import { useLocalSearchParams } from 'expo-router';

import { GalleryScreen } from '@/features/vault/GalleryScreen';

export default function GalleryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GalleryScreen key={String(id)} gameId={String(id)} />;
}

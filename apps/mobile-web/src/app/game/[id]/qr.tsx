import { useLocalSearchParams } from 'expo-router';

import { HostQrScreen } from '@/features/checkin/HostQrScreen';

export default function GameRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <HostQrScreen key={String(id)} gameId={String(id)} />;
}

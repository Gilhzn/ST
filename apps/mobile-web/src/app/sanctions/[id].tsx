import { useLocalSearchParams } from 'expo-router';

import { SanctionScreen } from '@/features/sanctions/SanctionScreen';

export default function SanctionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SanctionScreen key={String(id)} sanctionId={String(id)} />;
}

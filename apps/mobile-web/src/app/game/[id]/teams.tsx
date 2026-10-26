import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/i18n';

/** Design §13.9. Route exists and navigates; the full screen lands in the next wave. */
export default function GameSubScreen() {
  const { t } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PlaceholderScreen title={t('games:teams.title')} testID="screen.game.teams" key={id} />;
}

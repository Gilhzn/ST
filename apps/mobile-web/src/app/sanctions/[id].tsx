import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/i18n';

/** Sanction + appeal (design §13.13). Next wave. */
export default function SanctionScreen() {
  const { t } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PlaceholderScreen title={t('trust:sanctions.title')} testID="screen.sanction" key={id} />;
}

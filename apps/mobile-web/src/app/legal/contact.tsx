import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/i18n';

/** Legal page (always reachable, also signed out). Content next wave (legal namespace). */
export default function LegalScreen() {
  const { t } = useT();
  return <PlaceholderScreen title={t('legal:contact.title')} testID="screen.legal.contact" />;
}

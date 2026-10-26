import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { useT } from '@/i18n';

/** Inbox (design §13.15): chats + notifications. Next wave. */
export default function InboxScreen() {
  const { t } = useT();
  return <PlaceholderScreen title={t('common:nav.inbox')} testID="screen.inbox" back={false} />;
}

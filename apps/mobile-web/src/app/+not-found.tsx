import { EmptyState } from '@st/ui';
import { router } from 'expo-router';

import { Screen } from '@/components/Screen';
import { useT } from '@/i18n';

export default function NotFound() {
  const { t } = useT();
  return (
    <Screen testID="screen.notFound" back={false}>
      <EmptyState
        title={t('common:notFound.title')}
        body={t('common:notFound.body')}
        actionLabel={t('common:notFound.home')}
        onAction={() => router.replace('/')}
      />
    </Screen>
  );
}

import { EmptyState } from '@st/ui';
import type { ReactNode } from 'react';

import { useT } from '@/i18n';

import { Screen } from './Screen';

/** Route that exists and navigates, with its full UI landing in the next wave. */
export function PlaceholderScreen({ title, testID, children, back = true }: { title: string; testID: string; children?: ReactNode; back?: boolean }) {
  const { t } = useT();
  return (
    <Screen title={title} large testID={testID} back={back}>
      <EmptyState illustration="success" title={t('common:placeholder.title')} body={t('common:placeholder.body')} />
      {children}
    </Screen>
  );
}

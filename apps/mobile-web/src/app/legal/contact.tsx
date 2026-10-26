import { ListGroup, spacing, Text, useTheme } from '@st/ui';
import { View } from 'react-native';

import { SettingsFrame } from '@/features/settings/SettingsFrame';
import { useT } from '@/i18n';

function Row({ label, value, selectable }: { label: string; value: string; selectable?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ padding: spacing.lg, gap: spacing.xs, backgroundColor: colors.surface }}>
      <Text variant="footnote" weight="semibold" color="textSecondary">
        {label}
      </Text>
      <Text variant="body" selectable={selectable}>
        {value}
      </Text>
    </View>
  );
}

export default function ContactScreen() {
  const { t } = useT();
  return (
    <SettingsFrame title={t('legal:contact.title')} testID="screen.legal.contact" backFallback="/">
      <Text variant="body" style={{ fontSize: 18, lineHeight: 28, maxWidth: 680 }}>
        {t('legal:contact.body')}
      </Text>
      <ListGroup>
        <Row label={t('legal:contact.emailLabel')} value={t('legal:contact.email')} selectable />
        <Row label={t('legal:contact.addressLabel')} value={t('legal:contact.address')} />
      </ListGroup>
    </SettingsFrame>
  );
}

/**
 * Frame for the settings stack (design v2 §15.15): canvas background, large title with a
 * back button (mirrors in RTL), scrolling content capped at the reading width.
 */
import { LargeHeader, spacing, useTheme } from '@st/ui';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { goBack } from '@/components/Screen';
import { useT } from '@/i18n';

export function SettingsFrame({ title, subtitle, testID, backFallback = '/settings', children }: { title: string; subtitle?: string; testID: string; backFallback?: Href; children: ReactNode }) {
  const { t } = useT();
  const theme = useTheme();
  return (
    <SafeAreaView testID={testID} edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.huge }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center' }}>
          <LargeHeader title={title} subtitle={subtitle} onBack={() => goBack(backFallback)} backLabel={t('common:a11y.back')} />
          <View style={{ paddingStart: spacing.lg, paddingEnd: spacing.lg, gap: spacing.xl, paddingTop: spacing.sm }}>{children}</View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

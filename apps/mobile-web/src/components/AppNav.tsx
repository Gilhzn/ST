/**
 * Primary navigation (design §12): bottom tab bar on phones, a start-edge rail
 * (80dp) from 768 px with Create (volt) and Settings. Active = filled icon +
 * label + indicator bar (never color alone).
 */
import { radius, sizing, spacing, Text, useTheme, zIndex } from '@st/ui';
import { router, type Href } from 'expo-router';
import { TabList, TabSlot, Tabs, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useT } from '@/i18n';

import { Icon, type IconName } from './Icon';

interface TabDef {
  name: 'map' | 'games' | 'inbox' | 'profile';
  href: Href;
  icon: IconName;
  iconActive: IconName;
}

const TABS: TabDef[] = [
  { name: 'map', href: '/map', icon: 'map-marker-radius-outline', iconActive: 'map-marker-radius' },
  { name: 'games', href: '/games', icon: 'calendar-star-outline', iconActive: 'calendar-star' },
  { name: 'inbox', href: '/inbox', icon: 'message-text-outline', iconActive: 'message-text' },
  { name: 'profile', href: '/profile', icon: 'account-circle-outline', iconActive: 'account-circle' },
];

function TabButton({ def, vertical, isFocused, ...props }: TabTriggerSlotProps & { def: TabDef; vertical: boolean }) {
  const { t } = useT();
  const { colors } = useTheme();
  const label = t(`common:nav.${def.name}`);
  return (
    <Pressable
      {...props}
      testID={`nav.tab.${def.name}`}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!isFocused }}
      style={({ pressed }) => ({
        flex: vertical ? undefined : 1,
        minHeight: vertical ? 64 : 56,
        width: vertical ? sizing.railWidth : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xxs,
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <View
        style={{
          paddingStart: spacing.md,
          paddingEnd: spacing.md,
          paddingTop: spacing.xxs,
          paddingBottom: spacing.xxs,
          borderRadius: radius.pill,
          backgroundColor: isFocused ? colors.primarySubtle : 'transparent',
        }}
      >
        <Icon name={isFocused ? def.iconActive : def.icon} color={isFocused ? 'primary' : 'textSecondary'} />
      </View>
      <Text variant="caption" color={isFocused ? 'primaryText' : 'textSecondary'} numberOfLines={1} style={isFocused ? { fontWeight: '700' } : undefined}>
        {label}
      </Text>
    </Pressable>
  );
}

function RailAction({ icon, label, onPress, accent, testID }: { icon: IconName; label: string; onPress: () => void; accent?: boolean; testID: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width: sizing.railWidth, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: spacing.xxs, opacity: pressed ? 0.85 : 1 })}
    >
      <View
        style={{
          width: accent ? sizing.fab - 8 : 40,
          height: accent ? sizing.fab - 8 : 32,
          borderRadius: accent ? radius.lg : radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: accent ? colors.accent : 'transparent',
        }}
      >
        <Icon name={icon} color={accent ? 'onAccent' : 'textSecondary'} />
      </View>
      <Text variant="caption" color="textSecondary" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function AppTabs() {
  const { hasRail } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { t } = useT();
  const c = theme.colors;

  const triggers = TABS.map((def) => (
    <TabTrigger key={def.name} name={def.name} href={def.href} asChild>
      <TabButton def={def} vertical={hasRail} />
    </TabTrigger>
  ));

  if (hasRail) {
    return (
      <Tabs style={{ flex: 1, flexDirection: 'row' }}>
        <View
          testID="nav.rail"
          accessibilityRole="navigation"
          style={{
            width: sizing.railWidth,
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.md,
            backgroundColor: c.surface,
            borderEndWidth: 1,
            borderEndColor: c.border,
            alignItems: 'center',
            gap: spacing.sm,
            zIndex: zIndex.sticky,
          }}
        >
          <RailAction testID="nav.rail.create" icon="plus" label={t('map:createGame.fab')} accent onPress={() => router.push('/game/create')} />
          <TabList style={{ flexDirection: 'column', gap: spacing.xs }} accessibilityRole="tablist">
            {triggers}
          </TabList>
          <View style={{ flex: 1 }} />
          <RailAction testID="nav.rail.settings" icon="cog-outline" label={t('common:nav.settings')} onPress={() => router.push('/settings')} />
        </View>
        <TabSlot style={{ flex: 1 }} />
      </Tabs>
    );
  }

  return (
    <Tabs style={{ flex: 1 }}>
      <TabSlot style={{ flex: 1 }} />
      <TabList
        testID="nav.tabbar"
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row',
          paddingBottom: insets.bottom,
          backgroundColor: c.surface,
          borderTopWidth: 1,
          borderTopColor: c.border,
          zIndex: zIndex.sticky,
        }}
      >
        {triggers}
      </TabList>
    </Tabs>
  );
}

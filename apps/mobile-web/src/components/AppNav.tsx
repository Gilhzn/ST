/**
 * Primary navigation (design v2 §13): a blurred `TabBar` on phones (active pill + Phosphor fill
 * icon + semibold label, selection haptic, unread badge on Inbox) and, from 768 px, an 80dp rail
 * at the start edge with the brand mark, the volt Create FAB, vertical tab items and Settings.
 */
import { BrandMark, Fab, IconButton, spacing, TabBar, TabBarItem, useTheme, zIndex, type IconName } from '@st/ui';
import { router, usePathname, type Href } from 'expo-router';
import { TabList, TabSlot, Tabs, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useData } from '@/data/DataProvider';
import { useAsync } from '@/hooks/useAsync';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useT } from '@/i18n';

type TabName = 'map' | 'games' | 'inbox' | 'profile';

interface TabDef {
  name: TabName;
  href: Href;
  icon: IconName;
}

const TABS: TabDef[] = [
  { name: 'map', href: '/map', icon: 'MapTrifold' },
  { name: 'games', href: '/games', icon: 'CalendarStar' },
  { name: 'inbox', href: '/inbox', icon: 'ChatsCircle' },
  { name: 'profile', href: '/profile', icon: 'UserCircle' },
];

/** Unread notifications for the Inbox badge; refreshed whenever the route changes. */
function useInboxUnread(): number {
  const port = useData();
  const pathname = usePathname();
  const res = useAsync(
    () =>
      port
        .listNotifications({ limit: 50 })
        .then((list) => list.filter((n) => !n.readAt).length)
        .catch(() => 0),
    [port, pathname],
  );
  return res.data ?? 0;
}

function TabButton({
  def,
  vertical,
  badge,
  isFocused,
  ref: _ref,
  style: _style,
  ...props
}: TabTriggerSlotProps & { def: TabDef; vertical: boolean; badge?: number }) {
  const { t } = useT();
  return (
    <TabBarItem
      {...props}
      testID={`nav.tab.${def.name}`}
      icon={def.icon}
      label={t(`common:nav.${def.name}`)}
      active={!!isFocused}
      badge={badge && badge > 0 ? badge : undefined}
      vertical={vertical}
    />
  );
}

export function AppTabs() {
  const { hasRail } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { t } = useT();
  const unread = useInboxUnread();
  const c = theme.colors;

  const triggers = TABS.map((def) => (
    <TabTrigger key={def.name} name={def.name} href={def.href} asChild>
      <TabButton def={def} vertical={hasRail} badge={def.name === 'inbox' ? unread : undefined} />
    </TabTrigger>
  ));

  if (hasRail) {
    return (
      <Tabs style={{ flex: 1, flexDirection: 'row' }}>
        {/* TabList must be a direct child of Tabs (triggers are parsed from it); non-trigger children render as-is. */}
        <TabList
          testID="nav.rail"
          role="tablist"
          style={{
            width: theme.tokens.sizing.railWidth,
            flexDirection: 'column',
            justifyContent: 'flex-start',
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
            backgroundColor: c.surface,
            borderEndWidth: 1,
            borderEndColor: c.border,
            alignItems: 'center',
            gap: spacing.sm,
            zIndex: zIndex.sticky,
          }}
        >
          <View aria-hidden style={{ marginBottom: spacing.sm }}>
            <BrandMark size={36} />
          </View>
          <Fab testID="nav.rail.create" label={t('map:createGame.fab')} onPress={() => router.push('/game/create')} style={{ marginBottom: spacing.md }} />
          {triggers}
          <View style={{ flex: 1 }} />
          <IconButton testID="nav.rail.settings" icon="GearSix" variant="tonal" size="lg" label={t('common:nav.settings')} onPress={() => router.push('/settings')} />
        </TabList>
        <TabSlot style={{ flex: 1 }} />
      </Tabs>
    );
  }

  return (
    <Tabs style={{ flex: 1 }}>
      <TabSlot style={{ flex: 1 }} />
      <TabList asChild style={{ flexDirection: 'column', justifyContent: 'flex-start' }}>
        <TabBar testID="nav.tabbar" bottomInset={insets.bottom}>
          {triggers}
        </TabBar>
      </TabList>
    </Tabs>
  );
}

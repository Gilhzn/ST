/**
 * Design Language v2 specimen (dev only): every new @st/ui component in light / dark / RTL.
 * Open /dev/design (no sign-in needed). Query params: ?scheme=light|dark&dir=ltr|rtl.
 * Screenshot: `node scripts/screens.mjs --only design` (full page).
 * Copy here is placeholder specimen text, deliberately not localized.
 */
import {
  AuthHero,
  Avatar,
  AvatarStack,
  BrandMark,
  Button,
  Chip,
  ClusterMarker,
  EmptyState,
  Fab,
  GameHeroCard,
  Icon,
  IconButton,
  Illustration,
  LargeHeader,
  ListGroup,
  ListItem,
  MapPinMarker,
  ProgressRing,
  ReliabilityRing,
  Segmented,
  Skeleton,
  SkeletonGameCard,
  SportGlyphBadge,
  StatTile,
  StatusBadge,
  StatusPill,
  TabBar,
  TabBarItem,
  Text,
  TextField,
  ThemeProvider,
  Toast,
  sportKeys,
  useAppFonts,
  useTheme,
  type IllustrationName,
  type ThemePreference,
} from '@st/ui';
import { useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

const HE = {
  hero: 'מוצאים משחק. מגיעים. משחקים.',
  heroSub: 'משחקי שכונה ליד הבית, עם שחקנים שמגיעים.',
  games: 'משחקים',
  title: 'חמישייה בשקיעה בירקון',
  venue: 'מגרשי פארק הירקון',
};

export default function DesignSpecimen() {
  const params = useLocalSearchParams<{ scheme?: string; dir?: string }>();
  const { locale } = useT();
  const [scheme, setScheme] = useState<ThemePreference>(params.scheme === 'dark' || params.scheme === 'light' ? params.scheme : 'system');
  const [rtl, setRtl] = useState(params.dir ? params.dir === 'rtl' : locale === 'he' || locale === 'ar');
  const previewLocale = rtl ? (locale === 'ar' ? 'ar' : 'he') : locale === 'he' || locale === 'ar' ? 'en' : locale;
  const brandFonts = useAppFonts(previewLocale);

  return (
    <ThemeProvider key={`${scheme}-${rtl}`} locale={previewLocale} direction={rtl ? 'rtl' : 'ltr'} brandFonts={brandFonts} initialPreference={scheme}>
      <Specimen scheme={scheme} setScheme={setScheme} rtl={rtl} setRtl={setRtl} />
    </ThemeProvider>
  );
}

function Specimen({ scheme, setScheme, rtl, setRtl }: { scheme: ThemePreference; setScheme: (s: ThemePreference) => void; rtl: boolean; setRtl: (v: boolean) => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [seg, setSeg] = useState<'upcoming' | 'hosting' | 'past'>('upcoming');
  const [sports, setSports] = useState<string[]>(['football', 'padel']);
  const [radiusKm, setRadiusKm] = useState('5');
  const [tab, setTab] = useState('map');
  const c = theme.colors;
  const he = rtl;

  return (
    <View testID="dev.design" style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <AuthHero topInset={insets.top} title={he ? HE.hero : 'Find a game. Show up. Play.'} subtitle={he ? HE.heroSub : 'Pickup games near you, with players who actually show up.'} />

        <View style={{ padding: 16, gap: 12 }}>
          <Segmented
            label="Theme"
            value={scheme}
            onChange={setScheme}
            options={[
              { value: 'system', label: 'System', icon: 'Circle' },
              { value: 'light', label: 'Light', icon: 'Sun' },
              { value: 'dark', label: 'Dark', icon: 'Moon' },
            ]}
          />
          <Segmented
            label="Direction"
            value={rtl ? 'rtl' : 'ltr'}
            onChange={(v) => setRtl(v === 'rtl')}
            options={[
              { value: 'ltr', label: 'LTR · English' },
              { value: 'rtl', label: 'RTL · עברית' },
            ]}
          />
        </View>

        <LargeHeader
          eyebrow={he ? 'ערב טוב, דנה' : 'Good evening, Dana'}
          title={he ? HE.games : 'Games'}
          subtitle={he ? '8 משחקים ליד תל אביב' : '8 games near Tel Aviv'}
          actions={
            <>
              <IconButton icon="Bell" label="Notifications" variant="tonal" badge={3} />
              <Avatar name="Dana Levi" size="md" />
            </>
          }
        >
          <Segmented
            label="Show games"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'upcoming', label: he ? 'קרובים' : 'Upcoming', count: 3 },
              { value: 'hosting', label: he ? 'מארח/ת' : 'Hosting', count: 1 },
              { value: 'past', label: he ? 'עבר' : 'Past' },
            ]}
          />
        </LargeHeader>

        <Section title="Game cards">
          <GameHeroCard
            sport="football"
            sportLabel={he ? 'כדורגל · 5 על 5' : 'Football · 5v5'}
            title={he ? HE.title : 'Sunset 5v5 at Yarkon'}
            venue={he ? HE.venue : 'Park HaYarkon Fields'}
            distanceLabel="1.2 km"
            timeLabel="19:05"
            dayLabel={he ? 'היום' : 'Today'}
            relativeLabel={he ? 'בעוד 45 דק׳' : 'in 45 min'}
            filled={7}
            capacity={10}
            playersLabel={he ? '7 מתוך 10 שחקנים' : '7 of 10 players'}
            people={[{ name: 'Yossi Cohen' }, { name: 'Dana Levi' }, { name: 'נועה ברק' }, { name: 'Maya Ben-David' }]}
            peopleLabel="Yossi, Dana and 5 others"
            status={{ label: he ? 'מתמלא' : 'Filling fast', tone: 'glass', icon: 'Lightning' }}
            tags={[{ label: he ? 'מתחילים' : 'Beginner friendly', icon: 'HandWaving' }]}
            accessibilityLabel="Football, Sunset 5v5 at Yarkon, today 19:05, 7 of 10 players, 1.2 km"
            onPress={() => undefined}
          />
          <GameHeroCard
            sport="padel"
            sportLabel={he ? 'פאדל · זוגות' : 'Padel · Doubles'}
            title={he ? 'פאדל בוקר בנמל' : 'Morning padel at the Port'}
            venue="Tel Aviv Port Courts"
            distanceLabel="3.4 km"
            timeLabel="07:30"
            dayLabel={he ? 'מחר' : 'Tomorrow'}
            filled={4}
            capacity={4}
            playersLabel={he ? 'מלא · 4 מתוך 4' : 'Full · 4 of 4'}
            people={[{ name: 'Omar Haddad' }, { name: 'Lior Katz' }, { name: 'Shir Avraham' }, { name: 'Ben Tal' }]}
            peopleLabel="Omar, Lior, Shir and Ben"
            depositLabel={he ? 'פיקדון ₪20' : '₪20 deposit'}
            status={{ label: he ? 'רשימת המתנה' : 'Waitlist', tone: 'glass', icon: 'Hourglass' }}
            tags={[{ label: he ? 'נשים בלבד' : 'Women only', icon: 'GenderFemale' }]}
            hostReliability={{ status: 'green', label: he ? 'אמין/ה' : 'Reliable', percent: 96 }}
            accessibilityLabel="Padel, full, tomorrow 07:30"
            onPress={() => undefined}
          />
          <GameHeroCard
            sport="basketball"
            sportLabel="Basketball · 3x3"
            title="Gordon Beach Run"
            venue="Gordon Beach Courts"
            distanceLabel="0.8 km"
            timeLabel="18:00"
            dayLabel="Now"
            filled={5}
            capacity={6}
            playersLabel="5 of 6 players"
            status={{ label: 'Live', tone: 'live' }}
            accessibilityLabel="Basketball, live now"
            onPress={() => undefined}
          />
          <SkeletonGameCard />
        </Section>

        <Section title="Map markers">
          <MapPreview />
        </Section>

        <Section title="Filters">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {sportKeys.map((s) => (
              <Chip
                key={s}
                sport={s}
                label={s[0]!.toUpperCase() + s.slice(1)}
                selected={sports.includes(s)}
                onToggle={(on) => setSports((x) => (on ? [...x, s] : x.filter((y) => y !== s)))}
              />
            ))}
          </View>
          <View role="radiogroup" aria-label="Radius" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {['1', '2', '5', '10', '30', '50'].map((r) => (
              <Chip key={r} size="sm" selectionRole="radio" label={`${r} km`} selected={radiusKm === r} onToggle={() => setRadiusKm(r)} />
            ))}
          </View>
        </Section>

        <Section title="Buttons">
          <Button label={he ? 'הצטרפות למשחק' : 'Join game'} icon="Lightning" size="lg" fullWidth />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Button label="Check in" icon="MapPin" />
            <Button label="Chat" icon="ChatsCircle" variant="secondary" />
            <Button label="Directions" iconEnd="ArrowSquareOut" variant="outline" />
            <Button label="Create game" icon="Plus" variant="accent" />
            <Button label="Can't make it" variant="ghost" />
            <Button label="Cancel game" icon="Trash" variant="danger" size="sm" />
            <Button label="Joining…" loading />
            <Button label="Disabled" disabled />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <IconButton icon="ArrowLeft" label="Back" />
            <IconButton icon="ShareNetwork" label="Share" variant="tonal" />
            <IconButton icon="GpsFix" label="Locate me" variant="glass" />
            <IconButton icon="Star" label="Favorite" variant="tonal" selected />
            <IconButton icon="Plus" label="Add" variant="filled" />
            <Fab label="Create game" />
          </View>
          <Fab label={he ? 'יצירת משחק' : 'Create game'} extended />
        </Section>

        <Section title="Profile & stats">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
            <ReliabilityRing status="green" percent={92} label={he ? 'אמין/ה' : 'Reliable'} accessibilityLabel="Reliability 92 percent, reliable" />
            <View style={{ flex: 1, gap: 8 }}>
              <StatusBadge status="green" label="Reliable" percent={92} />
              <StatusBadge status="yellow" label="Caution" percent={74} />
              <StatusBadge status="red" label="Restricted" percent={52} />
              <StatusBadge status="new" label="New player" />
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <StatTile icon="SoccerBall" sport="football" value="13" label={he ? 'משחקים' : 'Games played'} caption="+3 this month" captionTone="positive" />
            <StatTile icon="CheckCircle" value="11" label={he ? 'נוכחות מאומתת' : 'Verified check-ins'} />
            <StatTile icon="Strategy" value="4" label={he ? 'כמארח/ת' : 'As host'} />
            <StatTile icon="Fire" sport="basketball" value="6" label={he ? 'רצף שבועות' : 'Week streak'} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <ProgressRing progress={0.7} size={56} label="Players" valueText="7 of 10">
              <Text variant="label" weight="bold">7/10</Text>
            </ProgressRing>
            <ProgressRing progress={0.33} size={56} gradient={['#E1FF66', '#00A846']} label="Check-in">
              <Icon name="MapPin" size={20} weight="fill" color="primary" />
            </ProgressRing>
            <AvatarStack people={[{ name: 'Yossi Cohen' }, { name: 'Dana Levi' }, { name: 'עמר חדאד' }, { name: 'Maya Ben-David' }, { name: 'Noa' }]} total={9} label="9 players" />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <StatusPill label="Open" tone="brand" icon="Users" />
            <StatusPill label="Live" tone="live" />
            <StatusPill label="Joined" tone="success" icon="CheckCircle" />
            <StatusPill label="Waitlist #2" tone="warning" icon="Hourglass" />
            <StatusPill label="Cancelled" tone="danger" icon="XCircle" />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            {sportKeys.map((s) => (
              <SportGlyphBadge key={s} sport={s} size={40} variant="solid" squircle />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            {sportKeys.map((s) => (
              <SportGlyphBadge key={s} sport={s} size={40} variant="tint" />
            ))}
          </View>
        </Section>

        <Section title="Lists">
          <ListGroup title={he ? 'חשבון' : 'Account'} footer="Your number is only shown to hosts of games you join.">
            <ListItem icon="Phone" title={he ? 'טלפון' : 'Phone'} value="+972 50-000-0001" onPress={() => undefined} />
            <ListItem icon="Translate" iconTone="info" title={he ? 'שפה' : 'Language'} value={he ? 'עברית' : 'English'} onPress={() => undefined} />
            <ListItem icon="Moon" iconTone="neutral" title={he ? 'ערכת נושא' : 'Theme'} value="System" onPress={() => undefined} />
            <ListItem icon="Bell" iconTone="warning" title={he ? 'התראות' : 'Notifications'} subtitle="Requests, reminders, chat" onPress={() => undefined} />
          </ListGroup>
          <ListGroup>
            <ListItem leading={<Avatar name="Yossi Cohen" size="md" decorative />} title="Yossi Cohen" subtitle="Host · Checked in" trailing={<StatusBadge size="sm" status="green" label="Reliable" />} />
            <ListItem icon="SignOut" title={he ? 'התנתקות' : 'Sign out'} destructive onPress={() => undefined} chevron={false} />
          </ListGroup>
        </Section>

        <Section title="Inputs">
          <TextField label={he ? 'חיפוש' : 'Search'} icon="MagnifyingGlass" placeholder="City, venue or address" />
          <TextField label="Phone number" icon="Phone" inputDirection="ltr" placeholder="50-000-0001" helperText="We'll text you a 6-digit code." />
          <TextField label="Display name" defaultValue="" error="Add a name so teammates know who you are." />
        </Section>

        <Section title="Toasts">
          <Toast tone="success" title="You're checked in" message="Have a great game." />
          <Toast tone="neutral" title="Request sent" message="Yossi will review it soon." actionLabel="Undo" onAction={() => undefined} />
          <Toast tone="warning" title="Up to 3 sports" message="Unselect one to add another." />
          <Toast tone="error" title="Couldn't load games" actionLabel="Retry" onAction={() => undefined} />
        </Section>

        <Section title="Loading">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Skeleton width={48} height={48} radius={24} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton height={16} width="70%" />
              <Skeleton height={12} width="40%" />
            </View>
          </View>
        </Section>

        <Section title="Empty states & illustrations">
          <View style={{ borderRadius: 20, ...theme.elevation(1) }}>
            <EmptyState
              title={he ? 'אין עדיין משחקים כאן' : 'No games nearby yet'}
              body={he ? 'היו הראשונים. צרו משחק ושחקנים יצטרפו.' : 'Be the first. Create a game and players nearby will see it.'}
              actionLabel={he ? 'יצירת משחק' : 'Create a game'}
              actionIcon="Plus"
              onAction={() => undefined}
              secondaryLabel="Widen to 10 km"
              onSecondary={() => undefined}
            />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
            {(['emptyGames', 'noChat', 'noNotifications', 'success', 'location', 'ageGate', 'offline', 'error'] as IllustrationName[]).map((n) => (
              <View key={n} style={{ alignItems: 'center', width: '48%', paddingTop: 8, paddingBottom: 8, borderRadius: 20, ...theme.elevation(1) }}>
                <Illustration name={n} size={120} />
                <Text variant="caption" color="textTertiary">{n}</Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Brand">
          <BrandMark size={44} wordmark />
        </Section>
      </ScrollView>

      <View style={{ position: 'absolute', bottom: 0, start: 0, end: 0 }}>
        <TabBar bottomInset={insets.bottom}>
          {(
            [
              ['map', 'MapTrifold', he ? 'מפה' : 'Map', 0],
              ['games', 'CalendarStar', he ? 'משחקים' : 'Games', 0],
              ['inbox', 'ChatsCircle', he ? 'הודעות' : 'Inbox', 2],
              ['profile', 'UserCircle', he ? 'פרופיל' : 'Profile', 0],
            ] as const
          ).map(([k, icon, label, badge]) => (
            <TabBarItem key={k} icon={icon} label={label} badge={badge || undefined} active={tab === k} onPress={() => setTab(k)} />
          ))}
        </TabBar>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ paddingStart: 16, paddingEnd: 16, paddingTop: 24, gap: 12 }}>
      <Text variant="overline" color="textTertiary">
        {title}
      </Text>
      {children}
    </View>
  );
}

function MapPreview() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const land = dark ? '#1B1D24' : '#F2EFE9';
  const road = dark ? '#2A2D38' : '#FFFFFF';
  const park = dark ? '#1C2B22' : '#DDEFD9';
  const water = dark ? '#16243A' : '#C9E3F6';
  return (
    <View style={{ height: 260, borderRadius: 20, overflow: 'hidden', backgroundColor: land }}>
      <Svg width="100%" height="100%" viewBox="0 0 360 260" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', top: 0, start: 0 }}>
        <Rect x={0} y={0} width={360} height={260} fill={land} />
        <Path d="M-10 200 C80 170 140 230 370 180 L370 270 L-10 270 Z" fill={water} />
        <Path d="M30 30 L130 20 L150 90 L50 110 Z" fill={park} />
        <Path d="M-10 130 L370 100" stroke={road} strokeWidth={10} />
        <Path d="M200 -10 L230 270" stroke={road} strokeWidth={8} />
        <Path d="M-10 60 L370 40" stroke={road} strokeWidth={5} />
        <Path d="M90 -10 L120 270" stroke={road} strokeWidth={5} />
      </Svg>
      <View style={{ position: 'absolute', top: 40, start: 50 }}>
        <MapPinMarker sport="football" accessibilityLabel="Football game" />
      </View>
      <View style={{ position: 'absolute', top: 24, start: 150 }}>
        <MapPinMarker sport="padel" state="selected" accessibilityLabel="Padel game, selected" />
      </View>
      <View style={{ position: 'absolute', top: 120, start: 250 }}>
        <MapPinMarker sport="basketball" state="live" accessibilityLabel="Basketball game, live" />
      </View>
      <View style={{ position: 'absolute', top: 140, start: 110 }}>
        <MapPinMarker sport="tennis" state="full" accessibilityLabel="Tennis game, full" />
      </View>
      <View style={{ position: 'absolute', top: 60, start: 280 }}>
        <MapPinMarker sport="running" accessibilityLabel="Running" />
      </View>
      <View style={{ position: 'absolute', top: 160, start: 20 }}>
        <MapPinMarker sport="volleyball" accessibilityLabel="Volleyball" />
      </View>
      <View style={{ position: 'absolute', top: 70, start: 200 }}>
        <ClusterMarker
          count={12}
          sports={[
            { sport: 'football', count: 6 },
            { sport: 'tennis', count: 3 },
            { sport: 'padel', count: 3 },
          ]}
          accessibilityLabel="12 games"
        />
      </View>
      <View style={{ position: 'absolute', top: 180, start: 200 }}>
        <ClusterMarker count={4} sports={[{ sport: 'running', count: 2 }, { sport: 'volleyball', count: 2 }]} accessibilityLabel="4 games" />
      </View>
      <View style={{ position: 'absolute', top: 12, end: 12, gap: 8 }}>
        <IconButton icon="GpsFix" label="Locate me" variant="glass" />
        <IconButton icon="ListBullets" label="List" variant="glass" />
      </View>
    </View>
  );
}

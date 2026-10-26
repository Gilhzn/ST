/**
 * Main Map (design §13.3).
 *
 * Phones: full-bleed map with floating glass controls (search + list/map toggle, sport rail,
 * radius segmented control), "Search this area" after panning, a recenter button and the volt
 * Create FAB, over a 3-detent sheet. Peek shows a hero-card carousel synced with the selected
 * pin; half/full show the full list. Wide web (≥ 768 px): a start-edge list pane instead.
 * The list view is always one tap away (the map is never the only way to find games).
 */
import {
  DEFAULT_RADIUS_KM,
  isRadiusKm,
  isSportId,
  RADII_KM,
  type LatLng,
  type NearbyGame,
  type NearbyVenue,
  type RadiusKm,
  type SportId,
  type StError,
} from '@st/domain';
import { isolate, Sheet, spacing, Stack, Text, useTheme, zIndex } from '@st/ui';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { gameTiming, GameCard } from '@/components/GameCard';
import { ErrorView, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { VenueCard } from '@/components/VenueCard';
import { useData } from '@/data/DataProvider';
import { useAsync } from '@/hooks/useAsync';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { deviceRegion } from '@/lib/device';
import { formatDay, formatKm, formatList, formatTime, usesMiles } from '@/lib/format';
import { Map } from '@/platform/map/Map';
import { zoomForRadius, type MapPoint } from '@/platform/map/Map.types';
import { distanceKm } from '@/platform/map/style';
import { getCurrentPosition, getLocationPermission, requestLocationPermission, type LocationPermission } from '@/platform/location';
import { getPref, PrefKeys, setPref } from '@/state/prefs';

import { DEFAULT_MAP_CENTER, SEED_CITIES } from './cities';
import { RadiusSelector, SportFilterBar } from './Filters';
import { GameCarousel, HERO_HEIGHT, MapEmptyCard } from './GameCarousel';
import { LocationDisclosure } from './LocationDisclosure';
import { CreateFab, RoundButton, SearchAreaButton, SearchBar, useWeight, ViewToggle } from './MapControls';
import { VenueDetails } from './VenueDetails';

type Selection = { kind: 'game' | 'venue'; id: string } | null;
type Sort = 'soonest' | 'nearest';

interface SavedFilters {
  sports: SportId[];
  radius: RadiusKm;
}

/** Games that started up to 3 h ago are still listed while live. */
const LIVE_LOOKBACK_MS = 3 * 60 * 60 * 1000;
/** Sheet peek: handle + header + hero carousel. */
const PEEK = 36 + 52 + HERO_HEIGHT + 4;

export default function MapScreen() {
  const { t, locale } = useT();
  const theme = useTheme();
  const port = useData();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const weight = useWeight();
  const { height, width } = useWindowDimensions();
  const { hasRail } = useBreakpoint();
  const now = useNow(30_000);
  const miles = useMemo(() => usesMiles(deviceRegion()), []);

  const [center, setCenter] = useState<LatLng>(DEFAULT_MAP_CENTER);
  const [cameraKey, setCameraKey] = useState(0);
  const [viewCenter, setViewCenter] = useState<LatLng | null>(null);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [radiusKm, setRadiusKm] = useState<RadiusKm>(DEFAULT_RADIUS_KM);
  const [zoom, setZoom] = useState(() => zoomForRadius(DEFAULT_RADIUS_KM));
  const [sports, setSports] = useState<SportId[]>([]);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [sort, setSort] = useState<Sort>('soonest');
  const [sheetIndex, setSheetIndex] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [permission, setPermission] = useState<LocationPermission | null>(null);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState('');
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [topH, setTopH] = useState(180);

  // Restore filters, then location (foreground only, after the disclosure).
  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await getPref<SavedFilters>(PrefKeys.mapFilters);
      if (alive && saved) {
        const s = (saved.sports ?? []).filter(isSportId).slice(0, 3);
        setSports(s);
        if (isRadiusKm(saved.radius)) {
          setRadiusKm(saved.radius);
          setZoom(zoomForRadius(saved.radius));
        }
      }
      if (alive) setFiltersLoaded(true);
      const p = await getLocationPermission();
      if (!alive) return;
      setPermission(p);
      if (p === 'granted') {
        const fix = await getCurrentPosition();
        if (alive && fix) {
          setCenter(fix.location);
          setUserLocation(fix.location);
        }
      } else if (p === 'undetermined') {
        const seen = await getPref<boolean>(PrefKeys.locationDisclosureSeen);
        if (alive && !seen) setShowDisclosure(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (filtersLoaded) void setPref<SavedFilters>(PrefKeys.mapFilters, { sports, radius: radiusKm });
  }, [filtersLoaded, sports, radiusKm]);

  const fromIso = useMemo(() => new Date(Math.floor((now - LIVE_LOOKBACK_MS) / 60_000) * 60_000).toISOString(), [now]);
  const games = useAsync(
    () => port.nearbyGames(center, radiusKm, sports, { from: fromIso }),
    [port, center.lat, center.lng, radiusKm, sports.join(','), fromIso],
    filtersLoaded,
  );
  const venues = useAsync(() => port.nearbyVenues(center, radiusKm, sports), [port, center.lat, center.lng, radiusKm, sports.join(',')], filtersLoaded);

  // Refresh when coming back from a game screen (joins, cancellations); skip the first focus.
  const focusedOnce = useRef(false);
  const reloadGames = games.reload;
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      void reloadGames();
    }, [reloadGames]),
  );

  const gameList = useMemo(() => {
    const list = (games.data ?? []).filter((g) => Date.parse(g.endsAt) > now);
    return sort === 'nearest' ? [...list].sort((a, b) => a.distanceM - b.distanceM) : list;
  }, [games.data, sort, now]);
  const venueList = venues.data ?? [];
  const venuesWithoutGames = useMemo(() => {
    const busy = new Set(gameList.map((g) => g.venueId).filter(Boolean));
    return venueList.filter((v) => !busy.has(v.id));
  }, [gameList, venueList]);

  const pinLabel = useCallback(
    (g: NearbyGame) =>
      formatList(
        [
          t(`common:sports.${g.sport}`),
          g.title,
          t('map:card.players', { joined: g.approvedCount, capacity: g.capacity }),
          t('common:datetime.dayTime', { day: formatDay(g.startsAt, locale, now), time: isolate(formatTime(g.startsAt, locale), 'ltr') }),
        ],
        locale,
      ),
    [t, locale, now],
  );

  const points = useMemo<MapPoint[]>(
    () => [
      ...gameList.map((g) => {
        const { live } = gameTiming(g, now);
        const full = g.approvedCount >= g.capacity;
        return {
          id: g.id,
          kind: 'game' as const,
          sport: g.sport,
          location: g.location ?? g.approxLocation,
          state: live ? ('live' as const) : full ? ('full' as const) : ('default' as const),
          label: pinLabel(g),
        };
      }),
      ...venueList.map((v) => ({
        id: v.id,
        kind: 'venue' as const,
        sport: v.sports[0] ?? 'football',
        location: v.location,
        state: 'default' as const,
        label: t('map:venues.pinA11y', { name: v.name }),
      })),
    ],
    [gameList, venueList, now, pinLabel, t],
  );

  const selectedVenue: NearbyVenue | undefined = selection?.kind === 'venue' ? venueList.find((v) => v.id === selection.id) : undefined;
  // The empty card needs a little more room than a hero card.
  const showEmpty = !games.loading && !games.error && gameList.length === 0;
  const peek = showEmpty ? PEEK + 48 : PEEK;
  const sheetPoints = useMemo(() => [peek, Math.round(height * 0.5), Math.max(peek + 80, height - insets.top - 120)], [peek, height, insets.top]);

  const onPressPoint = (p: MapPoint) => {
    setSelection({ kind: p.kind, id: p.id });
    // Games sync with the peek carousel; venues open their sheet at the half detent.
    if (p.kind === 'venue') setSheetIndex((i) => Math.max(1, i));
  };

  const changeRadius = (r: RadiusKm) => {
    setRadiusKm(r);
    setZoom(zoomForRadius(r));
    setCameraKey((k) => k + 1);
  };

  const recenterOn = (c: LatLng) => {
    setCenter(c);
    setViewCenter(null);
    setZoom(zoomForRadius(radiusKm));
    setCameraKey((k) => k + 1);
  };

  const locate = async () => {
    setLocating(true);
    try {
      let p = permission ?? (await getLocationPermission());
      if (p === 'undetermined') {
        setShowDisclosure(true);
        return;
      }
      if (p !== 'granted') {
        p = await requestLocationPermission();
        setPermission(p);
      }
      if (p === 'granted') {
        const fix = await getCurrentPosition();
        if (fix) {
          setUserLocation(fix.location);
          recenterOn(fix.location);
        }
      } else {
        recenterOn(center);
      }
    } finally {
      setLocating(false);
    }
  };

  const allowLocation = async () => {
    setLocating(true);
    await setPref(PrefKeys.locationDisclosureSeen, true);
    const p = await requestLocationPermission();
    setPermission(p);
    setShowDisclosure(false);
    if (p === 'granted') {
      const fix = await getCurrentPosition();
      if (fix) {
        setUserLocation(fix.location);
        recenterOn(fix.location);
      }
    }
    setLocating(false);
  };

  const dismissDisclosure = () => {
    setShowDisclosure(false);
    void setPref(PrefKeys.locationDisclosureSeen, true);
  };

  const cityMatches = query.trim()
    ? SEED_CITIES.filter((c) => c.name.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)))
    : [];
  const goToCity = (c: (typeof SEED_CITIES)[number]) => {
    recenterOn(c.center);
    setQuery('');
    setSelection(null);
  };

  // "Search this area" once the visible centre drifts a quarter-radius from the searched one.
  const drifted = !!viewCenter && distanceKm(viewCenter, center) > Math.max(0.3, radiusKm * 0.25);
  const searchThisArea = () => {
    if (!viewCenter) return;
    setCenter(viewCenter);
    setViewCenter(null);
    setSelection(null);
  };

  const sportNames = sports.length ? formatList(sports.map((s) => t(`common:sports.${s}`)), locale) : t('map:empty.allSports');
  const nextRadius = RADII_KM.find((r) => r > radiusKm);
  const title = t('map:sheet.title', { count: gameList.length });
  const radiusLabel = formatKm(radiusKm, locale, miles);
  const selectedGameId = selection?.kind === 'game' ? selection.id : null;

  const emptyCard = (
    <MapEmptyCard
      title={t('map:empty.title', { distance: radiusLabel, sports: sportNames })}
      hint={t('map:empty.hint')}
      widenLabel={nextRadius ? t('map:empty.widen', { distance: formatKm(nextRadius, locale, miles) }) : undefined}
      onWiden={nextRadius ? () => changeRadius(nextRadius) : undefined}
      createLabel={t('map:empty.create')}
      onCreate={() => router.push('/game/create')}
    />
  );

  const listBody = (
    <ListBody
      games={gameList}
      venues={venuesWithoutGames}
      loading={games.loading && !games.data}
      error={games.error}
      onRetry={() => void games.reload()}
      now={now}
      miles={miles}
      selectedId={selectedGameId}
      empty={emptyCard}
      onSelectVenue={(v) => setSelection({ kind: 'venue', id: v.id })}
    />
  );

  const sheetHeader = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 }}>
      <Text variant="title3" style={[{ flex: 1 }, weight('bold')]} accessibilityLiveRegion="polite" testID="map.sheet.title" numberOfLines={1}>
        {title}
      </Text>
      {gameList.length > 1 ? (
      <Pressable
        testID="map.sort.toggle"
        accessibilityRole="button"
        accessibilityLabel={t('map:sheet.sortA11y', { sort: sort === 'soonest' ? t('map:sheet.sortSoonest') : t('map:sheet.sortNearest') })}
        onPress={() => setSort((s) => (s === 'soonest' ? 'nearest' : 'soonest'))}
        hitSlop={8}
        style={({ pressed }) => ({
          height: 32,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingStart: 12,
          paddingEnd: 12,
          borderRadius: 16,
          backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.primarySubtle,
        })}
      >
        <Text variant="label" style={[{ color: theme.colors.onPrimarySubtle }, weight('semibold')]}>
          {sort === 'soonest' ? t('map:sheet.sortSoonest') : t('map:sheet.sortNearest')}
        </Text>
      </Pressable>
      ) : null}
    </View>
  );

  const listToggle = (
    <ViewToggle
      testID="map.list.toggle"
      icon={view === 'map' ? 'ListBullets' : 'MapTrifold'}
      label={view === 'map' ? t('map:sheet.showList') : t('map:sheet.showMap')}
      onPress={() => setView((v) => (v === 'map' ? 'list' : 'map'))}
    />
  );

  const searchBar = (trailing?: ReactNode) => (
    <View style={{ paddingStart: spacing.lg, paddingEnd: spacing.lg, zIndex: zIndex.overlay }}>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        onSubmit={() => cityMatches[0] && goToCity(cityMatches[0])}
        label={t('map:search.label')}
        placeholder={t('map:search.placeholder')}
        trailing={trailing}
      />
      {cityMatches.length ? (
        <View
          style={{
            position: 'absolute',
            top: 58,
            start: spacing.lg,
            end: spacing.lg,
            zIndex: zIndex.overlay,
            borderRadius: 18,
            overflow: 'hidden',
            backgroundColor: theme.colors.surface,
            ...theme.elevation(3),
          }}
        >
          {cityMatches.map((c) => (
            <Pressable
              key={c.id}
              testID={`map.search.city.${c.id}`}
              accessibilityRole="button"
              onPress={() => goToCity(c)}
              style={({ pressed }) => ({
                minHeight: 48,
                justifyContent: 'center',
                paddingStart: spacing.lg,
                paddingEnd: spacing.lg,
                backgroundColor: pressed ? theme.colors.surfaceSunken : undefined,
              })}
            >
              <Text variant="body">{c.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  const filters = (
    <View>
      <SportFilterBar selected={sports} onChange={setSports} onLimit={() => toast(t('map:filters.limitToast'))} />
      <View style={{ paddingStart: spacing.lg, paddingEnd: spacing.lg }}>
        <RadiusSelector value={radiusKm} onChange={changeRadius} miles={miles} />
      </View>
      {permission === 'denied' ? (
        <Text variant="caption" color="textSecondary" style={{ paddingStart: spacing.lg, paddingEnd: spacing.lg, paddingTop: spacing.xs }} testID="map.location.denied">
          {t('auth:permissions.location.deniedHint')}
        </Text>
      ) : null}
    </View>
  );

  const mapPadding = useMemo(() => (hasRail ? { top: 24, bottom: 24 } : { top: topH + 8, bottom: PEEK + 8 }), [hasRail, topH]);

  const map = (
    <Map
      testID="map.canvas"
      points={points}
      center={center}
      zoom={zoom}
      cameraKey={cameraKey}
      padding={mapPadding}
      radiusKm={radiusKm}
      radiusLabel={radiusLabel}
      userLocation={userLocation}
      selectedId={selection?.id ?? null}
      scheme={theme.scheme}
      onPressPoint={onPressPoint}
      onPressMap={() => setSelection(null)}
      onRegionChange={(r) => setViewCenter(r.center)}
      clusterLabel={(count, s) => t('map:cluster.a11y', { count, sports: formatList(s.map((x) => t(`common:sports.${x}`)), locale) })}
      accessibilityLabel={title}
      zoomInLabel={t('map:zoom.in')}
      zoomOutLabel={t('map:zoom.out')}
    />
  );

  const disclosure = showDisclosure ? (
    <View style={{ position: 'absolute', start: spacing.lg, end: spacing.lg, top: (hasRail ? insets.top + 24 : topH) + 8, zIndex: zIndex.overlay, maxWidth: 520, alignSelf: 'center' }}>
      <LocationDisclosure onAllow={() => void allowLocation()} onDismiss={dismissDisclosure} busy={locating} />
    </View>
  ) : null;

  const venueSheet = selectedVenue ? (
    <FlatList
      data={[selectedVenue]}
      keyExtractor={(v) => v.id}
      renderItem={({ item }) => <VenueDetails venue={item} games={gameList} now={now} miles={miles} onClose={() => setSelection(null)} />}
      contentContainerStyle={{ paddingBottom: spacing.xl }}
    />
  ) : null;

  const searchArea = (
    <SearchAreaButton visible={drifted && view === 'map'} label={t('map:searchArea.cta')} onPress={searchThisArea} />
  );

  // ---------------------------------------------------------------- wide: split view
  if (hasRail) {
    return (
      <View testID="screen.map" style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.colors.background }}>
        <View style={{ width: 400, borderEndWidth: 1, borderEndColor: theme.colors.border, backgroundColor: theme.colors.surfaceRaised }}>
          <View style={{ paddingTop: insets.top + spacing.md, gap: spacing.sm, paddingBottom: spacing.sm }}>
            {searchBar()}
            {filters}
            <View style={{ paddingStart: spacing.lg, paddingEnd: spacing.lg }}>{sheetHeader}</View>
          </View>
          <View style={{ flex: 1, paddingStart: spacing.lg, paddingEnd: spacing.lg }}>{venueSheet ?? listBody}</View>
        </View>
        <View style={{ flex: 1 }}>
          {map}
          <View pointerEvents="box-none" style={{ position: 'absolute', top: spacing.lg, start: 0, end: 0 }}>
            {searchArea}
          </View>
          <View pointerEvents="box-none" style={{ position: 'absolute', end: spacing.lg, bottom: spacing.lg, gap: spacing.md, alignItems: 'flex-end' }}>
            <RoundButton testID="map.locate" icon="NavigationArrow" label={t('map:locate.label')} busy={locating} active={!!userLocation} onPress={() => void locate()} />
            <CreateFab label={t('map:createGame.fab')} extended onPress={() => router.push('/game/create')} />
          </View>
          {disclosure}
        </View>
      </View>
    );
  }

  // ---------------------------------------------------------------- phones
  const scrimTop = theme.scheme === 'dark' ? ['rgba(11,10,28,0.72)', 'rgba(11,10,28,0)'] : ['rgba(246,246,251,0.85)', 'rgba(246,246,251,0)'];
  return (
    <View testID="screen.map" style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {view === 'map' ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}>
          {map}
          {/* soft legibility scrim under the floating controls */}
          <LinearGradient
            pointerEvents="none"
            colors={scrimTop as [string, string]}
            style={{ position: 'absolute', top: 0, start: 0, end: 0, height: topH * 0.75 }}
          />
        </View>
      ) : null}
      <View
        onLayout={(e) => setTopH(Math.round(e.nativeEvent.layout.height))}
        pointerEvents="box-none"
        style={{ paddingTop: insets.top + spacing.sm, zIndex: zIndex.sticky, gap: spacing.sm, backgroundColor: view === 'list' ? theme.colors.background : undefined }}
      >
        {searchBar(listToggle)}
        {filters}
      </View>
      {view === 'map' ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', top: topH + spacing.sm, start: 0, end: 0, zIndex: zIndex.sticky }}>
          {searchArea}
        </View>
      ) : null}
      {view === 'list' ? (
        <View style={{ flex: 1, paddingStart: spacing.lg, paddingEnd: spacing.lg }} testID="map.list">
          <View style={{ paddingTop: spacing.sm, paddingBottom: spacing.sm }}>{sheetHeader}</View>
          {listBody}
        </View>
      ) : (
        <Sheet
          snapPoints={sheetPoints}
          index={sheetIndex}
          onIndexChange={setSheetIndex}
          accessibilityLabel={title}
          expandLabel={t('map:sheet.expand')}
          collapseLabel={t('map:sheet.collapse')}
          header={sheetHeader}
        >
          <View style={{ flex: 1 }} testID="map.sheet">
            {venueSheet ? (
              <View style={{ flex: 1, paddingStart: spacing.lg, paddingEnd: spacing.lg }}>{venueSheet}</View>
            ) : sheetIndex === 0 ? (
              <PeekBody
                games={gameList}
                loading={games.loading && !games.data}
                error={games.error}
                onRetry={() => void games.reload()}
                empty={emptyCard}
                width={width}
                selectedId={selectedGameId}
                onSelect={(g) => setSelection({ kind: 'game', id: g.id })}
                now={now}
                miles={miles}
                label={t('map:carousel.label')}
              />
            ) : (
              <View style={{ flex: 1, paddingStart: spacing.lg, paddingEnd: spacing.lg }}>{listBody}</View>
            )}
          </View>
        </Sheet>
      )}
      {view === 'map' ? (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', end: spacing.lg, bottom: peek + spacing.lg, gap: spacing.md, alignItems: 'flex-end', zIndex: zIndex.fab }}
        >
          <RoundButton testID="map.locate" icon="NavigationArrow" label={t('map:locate.label')} busy={locating} active={!!userLocation} onPress={() => void locate()} />
          <CreateFab label={t('map:createGame.fab')} extended={false} onPress={() => router.push('/game/create')} />
        </View>
      ) : (
        <View pointerEvents="box-none" style={{ position: 'absolute', end: spacing.lg, bottom: spacing.lg, zIndex: zIndex.fab }}>
          <CreateFab label={t('map:createGame.fab')} extended onPress={() => router.push('/game/create')} />
        </View>
      )}
      {disclosure}
    </View>
  );
}

function PeekBody({
  games,
  loading,
  error,
  onRetry,
  empty,
  width,
  selectedId,
  onSelect,
  now,
  miles,
  label,
}: {
  games: readonly NearbyGame[];
  loading: boolean;
  error: StError | null;
  onRetry: () => void;
  empty: ReactNode;
  width: number;
  selectedId: string | null;
  onSelect: (g: NearbyGame) => void;
  now: number;
  miles: boolean;
  label: string;
}) {
  const theme = useTheme();
  if (loading) {
    return (
      <View style={{ flexDirection: 'row', gap: 12, paddingStart: 16 }} testID="state.loading">
        {[0, 1].map((i) => (
          <View key={i} style={{ width: width - 56, height: HERO_HEIGHT, borderRadius: 22, backgroundColor: theme.colors.skeleton }} />
        ))}
      </View>
    );
  }
  if (error && !games.length) return <View style={{ paddingStart: 16, paddingEnd: 16 }}><ErrorView error={error} onRetry={onRetry} /></View>;
  if (!games.length) return <View style={{ paddingStart: 16, paddingEnd: 16 }}>{empty}</View>;
  return (
    <GameCarousel
      games={games}
      width={width}
      selectedId={selectedId}
      onSelect={onSelect}
      onOpen={(g) => router.push(`/game/${g.id}`)}
      now={now}
      miles={miles}
      label={label}
    />
  );
}

function ListBody({
  games,
  venues,
  loading,
  error,
  onRetry,
  now,
  miles,
  selectedId,
  empty,
  onSelectVenue,
}: {
  games: readonly NearbyGame[];
  venues: readonly NearbyVenue[];
  loading: boolean;
  error: StError | null;
  onRetry: () => void;
  now: number;
  miles: boolean;
  selectedId: string | null;
  empty: ReactNode;
  onSelectVenue: (v: NearbyVenue) => void;
}) {
  const { t } = useT();
  if (loading) return <Skeleton rows={3} />;
  if (error && !games.length) return <ErrorView error={error} onRetry={onRetry} />;
  const ordered = selectedId ? [...games].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId)) : games;
  type Row = { type: 'game'; game: NearbyGame } | { type: 'venueHeader' } | { type: 'venue'; venue: NearbyVenue } | { type: 'empty' };
  const rows: Row[] = [
    ...(ordered.length ? ordered.map((game) => ({ type: 'game' as const, game })) : [{ type: 'empty' as const }]),
    ...(venues.length ? [{ type: 'venueHeader' as const }, ...venues.map((venue) => ({ type: 'venue' as const, venue }))] : []),
  ];
  return (
    <FlatList
      data={rows}
      keyExtractor={(r, i) => (r.type === 'game' ? r.game.id : r.type === 'venue' ? r.venue.id : `${r.type}-${i}`)}
      contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.huge }}
      renderItem={({ item }) => {
        if (item.type === 'empty') return <>{empty}</>;
        if (item.type === 'venueHeader') {
          return (
            <Stack gap="xxs" style={{ paddingTop: spacing.md }}>
              <Text variant="title3">{t('map:venues.sectionTitle')}</Text>
              <Text variant="caption" color="textSecondary">
                {t('map:venues.startOne')}
              </Text>
            </Stack>
          );
        }
        if (item.type === 'venue') {
          return <VenueCard venue={item.venue} miles={miles} testID={`map.venueCard.${item.venue.id}`} onPress={() => onSelectVenue(item.venue)} />;
        }
        return (
          <GameCard
            game={item.game}
            distanceM={item.game.distanceM}
            now={now}
            miles={miles}
            selected={item.game.id === selectedId}
            testID={`map.card.${item.game.id}`}
            onPress={() => router.push(`/game/${item.game.id}`)}
          />
        );
      }}
    />
  );
}

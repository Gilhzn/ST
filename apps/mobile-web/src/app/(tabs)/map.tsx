/**
 * Main Map (design §13.3): sport chips (≤ 3), radius 1/2/5/10/30/50, clustered
 * pins, a bottom sheet with game and venue cards, a List toggle (the map is
 * never the only way to find games), the venue sheet, and the volt Create FAB.
 * Wide web (≥ 768 px) uses a start-edge list pane instead of the sheet.
 */
import {
  DEFAULT_RADIUS_KM,
  isRadiusKm,
  isSportId,
  type LatLng,
  type NearbyGame,
  type NearbyVenue,
  type RadiusKm,
  type SportId,
  type StError,
} from '@st/domain';
import { EmptyState, isolate, radius, Row, Sheet, sizing, spacing, Stack, Text, TextField, useTheme, zIndex } from '@st/ui';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { gameTiming, GameCard } from '@/components/GameCard';
import { Icon } from '@/components/Icon';
import { ErrorView, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { VenueCard } from '@/components/VenueCard';
import { useData } from '@/data/DataProvider';
import { DEFAULT_CENTER } from '@/data/mock/seed';
import { SEED_CITIES } from '@/features/map/cities';
import { RadiusSelector, SportFilterBar } from '@/features/map/Filters';
import { LocationDisclosure } from '@/features/map/LocationDisclosure';
import { VenueDetails } from '@/features/map/VenueDetails';
import { useAsync } from '@/hooks/useAsync';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { deviceRegion } from '@/lib/device';
import { formatDay, formatKm, formatList, formatTime, usesMiles } from '@/lib/format';
import { Map } from '@/platform/map/Map';
import { zoomForRadius, type MapPoint } from '@/platform/map/Map.types';
import { getCurrentPosition, getLocationPermission, requestLocationPermission, type LocationPermission } from '@/platform/location';
import { getPref, PrefKeys, setPref } from '@/state/prefs';

type Selection = { kind: 'game' | 'venue'; id: string } | null;
type Sort = 'soonest' | 'nearest';

interface SavedFilters {
  sports: SportId[];
  radius: RadiusKm;
}

/** Games that started up to 3 h ago are still listed while live. */
const LIVE_LOOKBACK_MS = 3 * 60 * 60 * 1000;

export default function MapScreen() {
  const { t, locale } = useT();
  const theme = useTheme();
  const port = useData();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { hasRail } = useBreakpoint();
  const now = useNow(30_000);
  const miles = useMemo(() => usesMiles(deviceRegion()), []);

  const [center, setCenter] = useState<LatLng>(DEFAULT_CENTER);
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
  const sheetPoints = useMemo(() => [120, Math.round(height * 0.45), Math.max(320, height - insets.top - 190)], [height, insets.top]);

  const onPressPoint = (p: MapPoint) => {
    setSelection({ kind: p.kind, id: p.id });
    if (sheetIndex === 0) setSheetIndex(1);
  };

  const changeRadius = (r: RadiusKm) => {
    setRadiusKm(r);
    setZoom(zoomForRadius(r));
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
          setCenter(fix.location);
          setUserLocation(fix.location);
          setZoom(zoomForRadius(radiusKm));
        }
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
        setCenter(fix.location);
        setUserLocation(fix.location);
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
    setCenter(c.center);
    setZoom(zoomForRadius(radiusKm));
    setQuery('');
    setSelection(null);
  };

  const sportNames = sports.length ? formatList(sports.map((s) => t(`common:sports.${s}`)), locale) : t('map:empty.allSports');
  const nextRadius = ([1, 2, 5, 10, 30, 50] as RadiusKm[]).find((r) => r > radiusKm);
  const title = t('map:sheet.title', { count: gameList.length });

  const listBody = (
    <ListBody
      games={gameList}
      venues={venuesWithoutGames}
      loading={games.loading && !games.data}
      error={games.error}
      onRetry={() => void games.reload()}
      now={now}
      miles={miles}
      selectedId={selection?.kind === 'game' ? selection.id : null}
      empty={
        <View testID="map.empty">
        <EmptyState
          title={t('map:empty.title', { distance: formatKm(radiusKm, locale, miles), sports: sportNames })}
          actionLabel={nextRadius ? t('map:empty.widen', { distance: formatKm(nextRadius, locale, miles) }) : undefined}
          onAction={nextRadius ? () => changeRadius(nextRadius) : undefined}
          secondaryLabel={t('map:empty.create')}
          onSecondary={() => router.push('/game/create')}
        />
        </View>
      }
      onSelectVenue={(v) => setSelection({ kind: 'venue', id: v.id })}
    />
  );

  const sheetHeader = (
    <Row gap="sm" align="center" style={{ minHeight: 40 }}>
      <Text variant="title3" style={{ flex: 1 }} accessibilityLiveRegion="polite" testID="map.sheet.title" numberOfLines={1}>
        {title}
      </Text>
      <Pressable
        testID="map.sort.toggle"
        accessibilityRole="button"
        accessibilityLabel={t('map:sheet.sortA11y', { sort: sort === 'soonest' ? t('map:sheet.sortSoonest') : t('map:sheet.sortNearest') })}
        onPress={() => setSort((s) => (s === 'soonest' ? 'nearest' : 'soonest'))}
        hitSlop={8}
        style={{ minHeight: 40, justifyContent: 'center', paddingStart: spacing.sm, paddingEnd: spacing.sm }}
      >
        <Text variant="label" color="primaryText">
          {sort === 'soonest' ? t('map:sheet.sortSoonest') : t('map:sheet.sortNearest')}
        </Text>
      </Pressable>
    </Row>
  );

  const listToggle = (
    <Pressable
      testID="map.list.toggle"
      accessibilityRole="button"
      accessibilityLabel={view === 'map' ? t('map:sheet.showList') : t('map:sheet.showMap')}
      onPress={() => setView((v) => (v === 'map' ? 'list' : 'map'))}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        minHeight: sizing.touchTarget,
        paddingStart: spacing.md,
        paddingEnd: spacing.md,
        borderRadius: radius.pill,
        backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
        ...theme.elevation(2),
      })}
    >
      <Icon name={view === 'map' ? 'format-list-bulleted' : 'map-outline'} color="text" size={20} />
      <Text variant="label">{view === 'map' ? t('map:sheet.showList') : t('map:sheet.showMap')}</Text>
    </Pressable>
  );

  const topControls = (
    <View style={{ gap: spacing.xs }}>
      <Row gap="sm" style={{ paddingStart: spacing.lg, paddingEnd: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <TextField
            testID="map.search.input"
            label={t('map:search.label')}
            placeholder={t('map:search.placeholder')}
            value={query}
            onChangeText={setQuery}
            inputDirection="auto"
            returnKeyType="search"
            onSubmitEditing={() => cityMatches[0] && goToCity(cityMatches[0])}
            containerStyle={{ gap: 0 }}
            start={<Icon name="magnify" size={20} />}
          />
        </View>
        <Pressable
          testID="map.locate"
          accessibilityRole="button"
          accessibilityLabel={t('map:locate.label')}
          accessibilityState={{ busy: locating }}
          onPress={() => void locate()}
          style={({ pressed }) => ({
            width: sizing.touchTarget,
            height: sizing.touchTarget,
            marginTop: 20,
            borderRadius: sizing.touchTarget / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
            ...theme.elevation(2),
          })}
        >
          <Icon name="crosshairs-gps" color="primary" />
        </Pressable>
      </Row>
      {cityMatches.length ? (
        <View style={{ marginStart: spacing.lg, marginEnd: spacing.lg, borderRadius: radius.md, backgroundColor: theme.colors.surface, ...theme.elevation(3) }}>
          {cityMatches.map((c) => (
            <Pressable
              key={c.id}
              testID={`map.search.city.${c.id}`}
              accessibilityRole="button"
              onPress={() => goToCity(c)}
              style={{ minHeight: sizing.touchTarget, justifyContent: 'center', paddingStart: spacing.lg, paddingEnd: spacing.lg }}
            >
              <Text variant="body">{c.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <SportFilterBar selected={sports} onChange={setSports} onLimit={() => toast(t('map:filters.limitToast'))} />
      <RadiusSelector value={radiusKm} onChange={changeRadius} miles={miles} />
      {permission === 'denied' ? (
        <Text variant="caption" color="textSecondary" style={{ paddingStart: spacing.lg, paddingEnd: spacing.lg }} testID="map.location.denied">
          {t('auth:permissions.location.deniedHint')}
        </Text>
      ) : null}
    </View>
  );

  const map = (
    <Map
      testID="map.canvas"
      points={points}
      center={center}
      zoom={zoom}
      radiusKm={radiusKm}
      userLocation={userLocation}
      selectedId={selection?.id ?? null}
      scheme={theme.scheme}
      onPressPoint={onPressPoint}
      onRegionChange={(r) => setZoom(r.zoom)}
      clusterLabel={(count, s) => t('map:cluster.a11y', { count, sports: formatList(s.map((x) => t(`common:sports.${x}`)), locale) })}
      accessibilityLabel={title}
      zoomInLabel={t('map:zoom.in')}
      zoomOutLabel={t('map:zoom.out')}
    />
  );

  const fab = (
    <Pressable
      testID="map.fab.create"
      accessibilityRole="button"
      accessibilityLabel={t('map:createGame.fab')}
      onPress={() => router.push('/game/create')}
      style={({ pressed }) => ({
        position: 'absolute',
        end: spacing.lg,
        bottom: (view === 'list' ? 0 : sheetPoints[0] ?? 120) + spacing.lg,
        minWidth: sizing.fab,
        height: sizing.fab,
        borderRadius: radius.lg,
        flexDirection: 'row',
        gap: spacing.sm,
        paddingStart: spacing.lg,
        paddingEnd: spacing.lg,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.accent,
        zIndex: zIndex.fab,
        transform: pressed && !theme.reducedMotion ? [{ scale: 0.97 }] : undefined,
        boxShadow: '0px 6px 16px rgba(0,0,0,0.25)',
      })}
    >
      <Icon name="plus" color="onAccent" />
      <Text variant="bodyStrong" color="onAccent">
        {t('map:createGame.fab')}
      </Text>
    </Pressable>
  );

  const disclosure = showDisclosure ? (
    <View style={{ position: 'absolute', start: spacing.lg, end: spacing.lg, top: insets.top + 220, zIndex: zIndex.overlay, maxWidth: 520, alignSelf: 'center' }}>
      <LocationDisclosure onAllow={() => void allowLocation()} onDismiss={dismissDisclosure} busy={locating} />
    </View>
  ) : null;

  // ---------------------------------------------------------------- wide: split view
  if (hasRail) {
    return (
      <View testID="screen.map" style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.colors.background }}>
        <View style={{ width: sizing.splitListWidth, borderEndWidth: 1, borderEndColor: theme.colors.border, backgroundColor: theme.colors.surfaceRaised }}>
          <View style={{ paddingTop: insets.top + spacing.md, gap: spacing.sm, paddingBottom: spacing.sm }}>
            {topControls}
            <View style={{ paddingStart: spacing.lg, paddingEnd: spacing.lg }}>{sheetHeader}</View>
          </View>
          <View style={{ flex: 1, paddingStart: spacing.lg, paddingEnd: spacing.lg }}>
            {selectedVenue ? (
              <FlatList
                data={[selectedVenue]}
                keyExtractor={(v) => v.id}
                renderItem={({ item }) => <VenueDetails venue={item} games={gameList} now={now} miles={miles} onClose={() => setSelection(null)} />}
                contentContainerStyle={{ paddingBottom: spacing.xl }}
              />
            ) : (
              listBody
            )}
          </View>
        </View>
        <View style={{ flex: 1 }}>
          {map}
          {fab}
          {disclosure}
        </View>
      </View>
    );
  }

  // ---------------------------------------------------------------- phones
  return (
    <View testID="screen.map" style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {view === 'map' ? <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}>{map}</View> : null}
      <View style={{ paddingTop: insets.top + spacing.sm, zIndex: zIndex.sticky, gap: spacing.xs, backgroundColor: view === 'list' ? theme.colors.background : undefined }}>
        {topControls}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingStart: spacing.lg, paddingEnd: spacing.lg }}>{listToggle}</View>
      </View>
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
          <View style={{ flex: 1, paddingStart: spacing.lg, paddingEnd: spacing.lg }} testID="map.sheet">
            {selectedVenue ? (
              <FlatList
                data={[selectedVenue]}
                keyExtractor={(v) => v.id}
                renderItem={({ item }) => <VenueDetails venue={item} games={gameList} now={now} miles={miles} onClose={() => setSelection(null)} />}
                contentContainerStyle={{ paddingBottom: spacing.xl }}
              />
            ) : (
              listBody
            )}
          </View>
        </Sheet>
      )}
      {fab}
      {disclosure}
    </View>
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

# ADR 0002: MapLibre for maps on all platforms

- Status: Accepted (2026-10)

## Context
The map is the home screen on web, iOS and Android, with sport-specific pins, radius filters (1–50 km) and up to 3 sport filters. Google Maps and Mapbox SDKs add per-load pricing, account lock-in and different APIs per platform. Expo Go is not a constraint (we use a dev client).

## Decision
- Use `@maplibre/maplibre-react-native` (native) and `maplibre-gl` (web) behind one `Map` interface in `src/platform/map/` (`Map.native.tsx` / `Map.web.tsx`).
- Vector tiles from a swappable style URL (OpenFreeMap, MapTiler or Stadia); a local blank style for tests.
- Client-side clustering with `supercluster`; points come from the `nearby_venues` / `nearby_games` RPCs.
- Later, when viewports exceed roughly 10k points, serve vector tiles from PostGIS (`ST_AsMVT`).

## Consequences
- + No vendor lock-in, no per-map-load fees, same style spec on all platforms.
- + Deterministic e2e with a local style.
- − Two renderer libraries to keep in sync behind the interface.
- − Geocoding/search is not included; pick a provider separately when needed.
- − Tile provider terms (attribution, quotas) must be respected per provider.

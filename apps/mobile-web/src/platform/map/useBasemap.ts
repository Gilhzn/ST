/**
 * Resolves the basemap for the current theme and UI language. The offline canvas shows
 * immediately; a remote style replaces it once fetched and transformed (localized labels,
 * dark re-tint). If the fetch fails we stay on the offline canvas instead of a blank map.
 */
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useState } from 'react';

import { basemapSource, loadRemoteStyle, offlineStyle } from './style';

export interface Basemap {
  style: StyleSpecification;
  /** True while the offline canvas (lattice + vignette overlays) is what's on screen. */
  offline: boolean;
  /** Stable id of the resolved style (changes trigger `setStyle`). */
  key: string;
}

export function useBasemap(scheme: 'light' | 'dark', locale: string): Basemap {
  const source = useMemo(() => basemapSource(scheme), [scheme]);
  const fallback = useMemo<Basemap>(() => ({ style: offlineStyle(scheme), offline: true, key: `offline-${scheme}` }), [scheme]);
  const [remote, setRemote] = useState<Basemap | null>(null);
  const remoteKey = source.kind === 'remote' ? `${source.url}|${source.retint ? 'dark' : 'light'}|${locale}` : null;

  useEffect(() => {
    if (source.kind !== 'remote' || !remoteKey) {
      setRemote(null);
      return;
    }
    let alive = true;
    loadRemoteStyle(source.url, { locale, retint: source.retint })
      .then((style) => {
        if (alive) setRemote({ style, offline: false, key: remoteKey });
      })
      .catch(() => {
        if (alive) setRemote(null);
      });
    return () => {
      alive = false;
    };
  }, [remoteKey]);

  return remote && remote.key === remoteKey ? remote : fallback;
}

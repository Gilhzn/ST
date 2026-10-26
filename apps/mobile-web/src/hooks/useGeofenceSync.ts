/**
 * Stage-1 wake-up geofences for the player's upcoming approved games (native,
 * feature-flagged; a no-op on web or when EXPO_PUBLIC_FEATURE_GEOFENCE is off).
 */
import { useEffect } from 'react';

import { useData } from '@/data/DataProvider';
import { useT } from '@/i18n';
import { isGeofenceEnabled, syncGeofences } from '@/platform/geofence';

export function useGeofenceSync(enabled: boolean): void {
  const port = useData();
  const { t } = useT();
  useEffect(() => {
    if (!enabled || !isGeofenceEnabled()) return;
    let alive = true;
    (async () => {
      try {
        const games = await port.listMyGames();
        if (!alive) return;
        const targets = games
          .filter((g) => g.status === 'scheduled' && g.myParticipation?.status === 'approved' && g.location)
          .map((g) => ({ gameId: g.id, location: g.location!, startsAt: g.startsAt }));
        await syncGeofences(targets, { title: t('checkin:geofence.title'), body: t('checkin:geofence.body') });
      } catch {
        // Convenience only: check-in works without it.
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, port, t]);
}

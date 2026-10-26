/**
 * Keeps the screen awake while the host QR is shown. Web: Screen Wake Lock API where
 * supported (re-acquired when the tab becomes visible again). Native: the screen also
 * shows a "keep this screen on" hint; adding `expo-keep-awake` as a direct dependency
 * would let this hook hold the lock there too.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

export function useKeepScreenOn(active = true) {
  useEffect(() => {
    if (!active || Platform.OS !== 'web' || typeof navigator === 'undefined') return;
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wl) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = () => {
      wl.request('screen')
        .then((s) => {
          if (cancelled) void s.release().catch(() => undefined);
          else sentinel = s;
        })
        .catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}

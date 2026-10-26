/**
 * Auth session gate. Derives the app's coarse state from the DataPort:
 * `loading` → `signedOut` → (OTP) → `needsProfile` → (age gate + onboarding) → `ready`.
 * The root navigator protects route groups with it (Stack.Protected).
 */
import type { AuthUser, Profile } from '@st/domain';
import type { Href } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useData } from '@/data/DataProvider';

export type SessionStatus = 'loading' | 'signedOut' | 'needsProfile' | 'ready';

interface SessionValue {
  status: SessionStatus;
  user: AuthUser | null;
  profile: Profile | null;
  /** Re-reads the user and profile (after onboarding, profile edits). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

let pendingHref: Href | null = null;
/** Remembers where to go after sign-in (e.g. an invite link opened while signed out). */
export function setPostAuthRedirect(href: Href | null): void {
  pendingHref = href;
}
export function takePostAuthRedirect(): Href | null {
  const h = pendingHref;
  pendingHref = null;
  return h;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const port = useData();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);

  const load = useCallback(
    async (u: AuthUser | null) => {
      if (u?.hasProfile) {
        try {
          setProfile(await port.getMyProfile());
        } catch {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
      setUser(u);
    },
    [port],
  );

  useEffect(() => {
    let alive = true;
    port
      .currentUser()
      .then((u) => {
        if (alive) void load(u);
      })
      .catch(() => {
        if (alive) setUser(null);
      });
    const off = port.onAuthStateChange((u) => {
      if (alive) void load(u);
    });
    return () => {
      alive = false;
      off();
    };
  }, [port, load]);

  const refresh = useCallback(async () => {
    await load(await port.currentUser());
  }, [port, load]);

  const signOut = useCallback(async () => {
    await port.signOut();
    await load(null);
  }, [port, load]);

  const value = useMemo<SessionValue>(() => {
    const status: SessionStatus =
      user === undefined ? 'loading' : user === null ? 'signedOut' : user.hasProfile && profile ? 'ready' : user.hasProfile ? 'loading' : 'needsProfile';
    return { status, user: user ?? null, profile, refresh, signOut };
  }, [user, profile, refresh, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession() must be used inside <SessionProvider>');
  return ctx;
}

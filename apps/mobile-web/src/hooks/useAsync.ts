import { isStError, type StError } from '@st/domain';
import { useCallback, useEffect, useRef, useState } from 'react';

import { toStError } from '@/data/errors';

export interface AsyncState<T> {
  data: T | undefined;
  error: StError | null;
  /** True while a request is in flight (initial or reload). */
  loading: boolean;
  reload: () => Promise<void>;
  /** Replace the cached value (optimistic updates). */
  setData: (next: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Minimal query hook: runs `fn` when `deps` change, keeps the last value while
 * reloading, and normalises errors to StError. Results of stale runs are dropped.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[], enabled = true): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<StError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const run = useRef(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  const reload = useCallback(async () => {
    const id = ++run.current;
    setLoading(true);
    try {
      const value = await fnRef.current();
      if (id !== run.current) return;
      setDataState(value);
      setError(null);
    } catch (e) {
      if (id !== run.current) return;
      setError(isStError(e) ? e : toStError(e));
    } finally {
      if (id === run.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    // `deps` is the caller's dependency list.
  }, [enabled, reload, ...deps]);

  const setData = useCallback((next: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof next === 'function' ? (next as (p: T | undefined) => T)(prev) : next));
  }, []);

  return { data, error, loading, reload, setData };
}

/** Wraps an action with a busy flag and StError normalisation. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StError | null>(null);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fnRef.current(...args);
    } catch (e) {
      setError(isStError(e) ? e : toStError(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy, error, setError };
}

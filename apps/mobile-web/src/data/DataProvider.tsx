import { createContext, useContext, useState, type ReactNode } from 'react';

import type { DataPort } from './DataPort';

interface DataContextValue {
  port: DataPort;
  mode: 'mock' | 'supabase';
}

const DataContext = createContext<DataContextValue | null>(null);

/** Provides the single DataPort instance for the app. Screens obtain it with `useData()`. */
export function DataProvider({
  children,
  create,
  mode,
}: {
  children: ReactNode;
  create: () => DataPort;
  mode: 'mock' | 'supabase';
}) {
  const [port] = useState(create);
  return <DataContext.Provider value={{ port, mode }}>{children}</DataContext.Provider>;
}

export function useData(): DataPort {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData() must be used inside <DataProvider>');
  return ctx.port;
}

export function useDataMode(): 'mock' | 'supabase' {
  return useContext(DataContext)?.mode ?? 'mock';
}

/**
 * Blocked list with names. `DataPort.listBlocked()` returns ids only and a
 * blocked user's public profile is hidden by design, so adapters may implement
 * this optional extension to label the blocker's own list:
 *
 * - InMemoryAdapter: joins the seeded profiles.
 * - SupabaseAdapter: `public_profiles` hides blocked pairs, so the name is
 *   captured just before `block_user` and kept on this device (a server
 *   `list_blocked()` RPC returning names would make it cross-device).
 *
 * Callers use {@link listBlockedNamed}; entries without a known name get
 * `displayName: null` (show a neutral "Blocked player" label).
 */
import type { Block, UserId } from '@st/domain';

import type { DataPort } from './DataPort';

export interface BlockedEntry extends Block {
  displayName: string | null;
  avatarUrl: string | null;
}

export interface BlockedNamesExtension {
  listBlockedNamed(): Promise<BlockedEntry[]>;
}

function hasExtension(port: DataPort): port is DataPort & BlockedNamesExtension {
  return typeof (port as Partial<BlockedNamesExtension>).listBlockedNamed === 'function';
}

export async function listBlockedNamed(port: DataPort): Promise<BlockedEntry[]> {
  if (hasExtension(port)) return port.listBlockedNamed();
  const blocks = await port.listBlocked();
  return blocks.map((b) => ({ ...b, displayName: null, avatarUrl: null }));
}

export type BlockedNameCache = Record<UserId, { displayName: string; avatarUrl: string | null }>;

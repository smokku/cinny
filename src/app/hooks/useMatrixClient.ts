import { createContext, useContext } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { liveClientsAtom, LiveClient } from '../state/clientManager';
import { currentAccountIdAtom, roomOwnerByRoomIdAtom } from '../state/sessions';

// ---------------------------------------------------------------------------
// Room-scoped / current-account MatrixClient (primary hook)
// ---------------------------------------------------------------------------
const MatrixClientContext = createContext<MatrixClient | null>(null);

export const MatrixClientProvider = MatrixClientContext.Provider;

export function useMatrixClient(): MatrixClient {
  const mx = useContext(MatrixClientContext);
  if (!mx) throw new Error('MatrixClient not initialized!');
  return mx;
}

// ---------------------------------------------------------------------------
// Multi-account hooks
// ---------------------------------------------------------------------------

/** All live clients as a Map<userId, LiveClient> */
export function useLiveClients(): Map<string, LiveClient> {
  return useAtomValue(liveClientsAtom);
}

/** The current account userId */
export function useCurrentAccountId(): string | null {
  return useAtomValue(currentAccountIdAtom);
}

/** The MatrixClient for the current account (may be undefined during startup) */
export function useCurrentAccountClient(): MatrixClient | undefined {
  const clients = useAtomValue(liveClientsAtom);
  const currentId = useAtomValue(currentAccountIdAtom);
  if (!currentId) return undefined;
  return clients.get(currentId)?.client;
}

/** Resolve the owning MatrixClient for a room by roomId */
export function useRoomOwnerClient(roomId: string): MatrixClient | undefined {
  const ownerMap = useAtomValue(roomOwnerByRoomIdAtom);
  const clients = useAtomValue(liveClientsAtom);
  const currentId = useAtomValue(currentAccountIdAtom);

  const ownerId = ownerMap[roomId] ?? currentId;
  if (!ownerId) return undefined;
  return clients.get(ownerId)?.client;
}

/** Look up a specific account's client */
export function useClientForUserId(userId: string): MatrixClient | undefined {
  const clients = useAtomValue(liveClientsAtom);
  return clients.get(userId)?.client;
}

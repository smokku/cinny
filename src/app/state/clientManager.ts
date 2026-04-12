import { atom } from 'jotai';
import { MatrixClient, SyncState } from 'matrix-js-sdk';
import { Session } from './sessions';

// ---------------------------------------------------------------------------
// Types – Commet-style LiveClient per account
// ---------------------------------------------------------------------------
export type LiveClient = {
  session: Session;
  client: MatrixClient;
  syncState: SyncState | null;
};

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

/** Registry of all running Matrix clients, keyed by userId */
export const liveClientsAtom = atom<Map<string, LiveClient>>(new Map());

/** Derived: get a specific client by userId */
export const clientForUserIdAtom = atom((get) => {
  const clients = get(liveClientsAtom);
  return (userId: string): MatrixClient | undefined => clients.get(userId)?.client;
});

/** Derived: list of all live MatrixClient instances */
export const allClientsAtom = atom((get) => {
  const clients = get(liveClientsAtom);
  return Array.from(clients.values()).map((lc) => lc.client);
});

/** Derived: at least one client has reached SYNCING or PREPARED */
export const isAnySyncingAtom = atom((get) => {
  const clients = get(liveClientsAtom);
  return Array.from(clients.values()).some(
    (lc) => lc.syncState === SyncState.Syncing || lc.syncState === SyncState.Prepared
  );
});

// ---------------------------------------------------------------------------
// Actions (imperative atoms)
// ---------------------------------------------------------------------------

/** Register a new live client in the registry */
export const addLiveClientAtom = atom(null, (_get, set, liveClient: LiveClient) => {
  set(liveClientsAtom, (prev) => {
    const next = new Map(prev);
    next.set(liveClient.session.userId, liveClient);
    return next;
  });
});

/** Update sync state for a specific account */
export const updateSyncStateAtom = atom(
  null,
  (_get, set, payload: { userId: string; syncState: SyncState }) => {
    set(liveClientsAtom, (prev) => {
      const lc = prev.get(payload.userId);
      if (!lc) return prev;
      const next = new Map(prev);
      next.set(payload.userId, { ...lc, syncState: payload.syncState });
      return next;
    });
  }
);

/** Remove a client from the registry (does NOT stop/logout — caller does that) */
export const removeLiveClientAtom = atom(null, (_get, set, userId: string) => {
  set(liveClientsAtom, (prev) => {
    const next = new Map(prev);
    next.delete(userId);
    return next;
  });
});

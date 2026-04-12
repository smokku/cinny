import { atom } from 'jotai';
import { MatrixClient } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { Membership } from '../../../types/matrix/room';
import { RoomsAction, useBindRoomsWithMembershipsAtom } from './utils';

// ---------------------------------------------------------------------------
// Per-account storage (Map<userId, roomId[]>)
// ---------------------------------------------------------------------------
export const roomsByAccountAtom = atom<Map<string, string[]>>(new Map());

const accountRoomsCache = new Map<string, ReturnType<typeof createAccountRoomsAtom>>();

function createAccountRoomsAtom(userId: string) {
  return atom<string[], [RoomsAction], void>(
    (get) => get(roomsByAccountAtom).get(userId) ?? [],
    (_get, set, action) => {
      set(roomsByAccountAtom, (prev) => {
        const next = new Map(prev);
        if (action.type === 'INITIALIZE') {
          next.set(userId, action.rooms);
        } else {
          const current = next.get(userId) ?? [];
          const filtered = current.filter((id) => id !== action.roomId);
          if (action.type === 'PUT') filtered.push(action.roomId);
          next.set(userId, filtered);
        }
        return next;
      });
    }
  );
}

export function getAccountRoomsAtom(userId: string) {
  let a = accountRoomsCache.get(userId);
  if (!a) {
    a = createAccountRoomsAtom(userId);
    accountRoomsCache.set(userId, a);
  }
  return a;
}

// ---------------------------------------------------------------------------
// Aggregated read-only atom (union of all accounts, deduplicated)
// ---------------------------------------------------------------------------
export const allRoomsAtom = atom<string[]>((get) => {
  const byAccount = get(roomsByAccountAtom);
  const seen = new Set<string>();
  const result: string[] = [];
  byAccount.forEach((rooms) => {
    rooms.forEach((roomId) => {
      if (!seen.has(roomId)) {
        seen.add(roomId);
        result.push(roomId);
      }
    });
  });
  return result;
});

// ---------------------------------------------------------------------------
// Cleanup: remove one account's rooms
// ---------------------------------------------------------------------------
export const removeAccountRoomsAtom = atom(null, (_get, set, userId: string) => {
  set(roomsByAccountAtom, (prev) => {
    const next = new Map(prev);
    next.delete(userId);
    return next;
  });
});

// ---------------------------------------------------------------------------
// Binding hook (per-account: extracts userId from MatrixClient)
// ---------------------------------------------------------------------------
export const useBindAllRoomsAtom = (mx: MatrixClient) => {
  const userId = mx.getSafeUserId();
  const accountAtom = useMemo(() => getAccountRoomsAtom(userId), [userId]);
  useBindRoomsWithMembershipsAtom(
    mx,
    accountAtom,
    useMemo(() => [Membership.Join], [])
  );
};

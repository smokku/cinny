import { atom } from 'jotai';
import { MatrixClient } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { Membership } from '../../../types/matrix/room';
import { RoomsAction, useBindRoomsWithMembershipsAtom } from './utils';

// ---------------------------------------------------------------------------
// Per-account storage (Map<userId, roomId[]>)
// ---------------------------------------------------------------------------
export const invitesByAccountAtom = atom<Map<string, string[]>>(new Map());

const accountInvitesCache = new Map<string, ReturnType<typeof createAccountInvitesAtom>>();

function createAccountInvitesAtom(userId: string) {
  return atom<string[], [RoomsAction], void>(
    (get) => get(invitesByAccountAtom).get(userId) ?? [],
    (_get, set, action) => {
      set(invitesByAccountAtom, (prev) => {
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

function getAccountInvitesAtom(userId: string) {
  let a = accountInvitesCache.get(userId);
  if (!a) {
    a = createAccountInvitesAtom(userId);
    accountInvitesCache.set(userId, a);
  }
  return a;
}

// ---------------------------------------------------------------------------
// Aggregated read-only atom (union of all accounts, deduplicated)
// ---------------------------------------------------------------------------
export const allInvitesAtom = atom<string[]>((get) => {
  const byAccount = get(invitesByAccountAtom);
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
// Cleanup
// ---------------------------------------------------------------------------
export const removeAccountInvitesAtom = atom(null, (_get, set, userId: string) => {
  set(invitesByAccountAtom, (prev) => {
    const next = new Map(prev);
    next.delete(userId);
    return next;
  });
});

// ---------------------------------------------------------------------------
// Binding hook (per-account)
// ---------------------------------------------------------------------------
export const useBindAllInvitesAtom = (mx: MatrixClient) => {
  const userId = mx.getSafeUserId();
  const accountAtom = useMemo(() => getAccountInvitesAtom(userId), [userId]);
  useBindRoomsWithMembershipsAtom(
    mx,
    accountAtom,
    useMemo(() => [Membership.Invite], [])
  );
};

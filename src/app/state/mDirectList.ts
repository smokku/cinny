import { atom, useSetAtom } from 'jotai';
import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { useEffect, useMemo } from 'react';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { getAccountData, getMDirects } from '../utils/room';

export type MDirectAction = {
  type: 'INITIALIZE' | 'UPDATE';
  rooms: Set<string>;
};

// ---------------------------------------------------------------------------
// Per-account storage (Map<userId, Set<roomId>>)
// ---------------------------------------------------------------------------
export const mDirectByAccountAtom = atom<Map<string, Set<string>>>(new Map());

const accountMDirectCache = new Map<string, ReturnType<typeof createAccountMDirectAtom>>();

function createAccountMDirectAtom(userId: string) {
  return atom<Set<string>, [MDirectAction], void>(
    (get) => get(mDirectByAccountAtom).get(userId) ?? new Set(),
    (_get, set, action) => {
      set(mDirectByAccountAtom, (prev) => {
        const next = new Map(prev);
        next.set(userId, action.rooms);
        return next;
      });
    }
  );
}

function getAccountMDirectAtom(userId: string) {
  let a = accountMDirectCache.get(userId);
  if (!a) {
    a = createAccountMDirectAtom(userId);
    accountMDirectCache.set(userId, a);
  }
  return a;
}

// ---------------------------------------------------------------------------
// Aggregated read-only atom (union of all DM room sets)
// ---------------------------------------------------------------------------
export const mDirectAtom = atom<Set<string>>((get) => {
  const byAccount = get(mDirectByAccountAtom);
  const merged = new Set<string>();
  byAccount.forEach((rooms) => {
    rooms.forEach((roomId) => merged.add(roomId));
  });
  return merged;
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
export const removeAccountMDirectAtom = atom(null, (_get, set, userId: string) => {
  set(mDirectByAccountAtom, (prev) => {
    const next = new Map(prev);
    next.delete(userId);
    return next;
  });
});

// ---------------------------------------------------------------------------
// Binding hook (per-account)
// ---------------------------------------------------------------------------
export const useBindMDirectAtom = (mx: MatrixClient) => {
  const userId = mx.getSafeUserId();
  const accountAtom = useMemo(() => getAccountMDirectAtom(userId), [userId]);
  const setMDirect = useSetAtom(accountAtom);

  useEffect(() => {
    const mDirectEvent = getAccountData(mx, AccountDataEvent.Direct);
    if (mDirectEvent) {
      setMDirect({
        type: 'INITIALIZE',
        rooms: getMDirects(mDirectEvent),
      });
    }

    const handleAccountData = (event: MatrixEvent) => {
      if (event.getType() === AccountDataEvent.Direct) {
        setMDirect({
          type: 'UPDATE',
          rooms: getMDirects(event),
        });
      }
    };

    mx.on(ClientEvent.AccountData, handleAccountData);
    return () => {
      mx.removeListener(ClientEvent.AccountData, handleAccountData);
    };
  }, [mx, setMDirect]);
};

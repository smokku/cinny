import { atom } from 'jotai';
import { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';

export const NICKNAMES_KEY = 'sableNicknames';

export type Nicknames = Record<string, string>;

// ---------------------------------------------------------------------------
// Per-account storage (Map<userId, Nicknames>)
// ---------------------------------------------------------------------------
export const nicknamesByAccountAtom = atom<Map<string, Nicknames>>(new Map());

// ---------------------------------------------------------------------------
// Aggregated read-only atom (merge all accounts, last-write-wins)
// ---------------------------------------------------------------------------
export const nicknamesAtom = atom<Nicknames>((get) => {
  const byAccount = get(nicknamesByAccountAtom);
  const merged: Nicknames = {};
  byAccount.forEach((nicks) => {
    Object.assign(merged, nicks);
  });
  return merged;
});

// ---------------------------------------------------------------------------
// Per-account write atom (for binding from a specific client)
// ---------------------------------------------------------------------------
export const setAccountNicknamesAtom = atom(
  null,
  (_get, set, payload: { accountId: string; nicknames: Nicknames }) => {
    set(nicknamesByAccountAtom, (prev) => {
      const next = new Map(prev);
      next.set(payload.accountId, payload.nicknames);
      return next;
    });
  }
);

// ---------------------------------------------------------------------------
// Write a single nickname (writes to the owning account)
// ---------------------------------------------------------------------------
export const setNicknameAtom = atom<
  null,
  [userId: string, nick: string | undefined, mx: MatrixClient],
  void
>(null, (get, set, userId, nick, mx) => {
  const accountId = mx.getSafeUserId();
  const byAccount = get(nicknamesByAccountAtom);
  const accountNicks = { ...(byAccount.get(accountId) ?? {}) };

  if (nick === undefined || nick.trim() === '') {
    delete accountNicks[userId];
  } else {
    accountNicks[userId] = nick.trim();
  }

  set(nicknamesByAccountAtom, (prev) => {
    const next = new Map(prev);
    next.set(accountId, accountNicks);
    return next;
  });

  mx.setAccountData(AccountDataEvent.SableNicknames as any, accountNicks as any);
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
export const removeAccountNicknamesAtom = atom(null, (_get, set, userId: string) => {
  set(nicknamesByAccountAtom, (prev) => {
    const next = new Map(prev);
    next.delete(userId);
    return next;
  });
});

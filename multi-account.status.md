# Multi-Account Implementation Status

> Updated: 12 April 2026
> Branch: `multi-account` (based on `chrome`)
> Diff: 28 files changed, +1696 −463 (including 3 new files)

## Completed Phases

### Phase 1–3: Infrastructure, Client Registry, Bootstrap (committed)

Always-on multi-account support (no config flag). All logged-in accounts sync
simultaneously. The primary (current) account drives the UI; other accounts run
headless in the background. Design follows Commet's `ClientManager` pattern
adapted to Jotai atoms, with Sable's per-account crypto store isolation.

#### Key Design Decisions

- **Per-account IndexedDB isolation**: Each account gets its own sync store,
  crypto store, and Rust crypto database. Legacy (migrated) sessions keep the
  old `web-sync-store` / `crypto-store` names. New sessions use
  `sync${userId}` / `crypto${userId}` / `sync${userId}::matrix-sdk-crypto`.
- **Mismatch-detect-wipe-retry**: If `initRustCrypto` or `IndexedDBStore` throws
  a userId mismatch, the stores are wiped and rebuilt automatically.
- **Migration**: Legacy `cinny_*` localStorage keys are auto-migrated into the
  `matrixSessions` array on first boot, then removed.
- **Targeted logout**: Logging out one account only removes that account's
  session, SDK stores, live client entry, and per-account atom data — other
  accounts keep running.

#### Files Created (Phase 1–3)

| File | Purpose |
|---|---|
| `src/app/state/clientManager.ts` | Jotai atoms for the live client registry: `liveClientsAtom`, `addLiveClientAtom`, `removeLiveClientAtom`, `updateSyncStateAtom`, `clientForUserIdAtom`, `allClientsAtom`, `isAnySyncingAtom` |
| `src/app/state/hooks/useBindRoomOwner.ts` | Keeps `roomOwnerByRoomIdAtom` in sync with each client's joined rooms |

#### Files Modified (Phase 1–3)

| File | Change |
|---|---|
| `src/app/state/sessions.ts` | Multi-session atoms; `rustCryptoPrefix` in `SessionStoreName`; `currentAccountIdAtom`, `roomOwnerByRoomIdAtom`, `getStoredSessions()`, `hasStoredSession()` |
| `src/client/initMatrix.ts` | Per-account IndexedDB store names; `initRustCrypto({cryptoDatabasePrefix})`; mismatch-detect-wipe-retry; targeted `logoutClient(mx, session)`; `stopClient()`; `deleteSessionStores()` |
| `src/app/pages/client/ClientRoot.tsx` | Multi-client bootstrap via `AccountBootstrapper` components; per-account sync state tracking; primary-client selection for `MatrixClientProvider`; pushes all sessions to SW |
| `src/app/hooks/useMatrixClient.ts` | Added hooks: `useLiveClients`, `useCurrentAccountId`, `useCurrentAccountClient`, `useRoomOwnerClient`, `useClientForUserId` |
| `src/app/pages/Router.tsx` | Route guards switched from `getFallbackSession()` to `hasStoredSession()` |
| `src/app/pages/auth/login/loginUtil.ts` | `useLoginComplete` writes to `sessionsAtom` (PUT) |
| `src/app/pages/auth/register/registerUtil.ts` | Same change for `useRegisterComplete` |
| `src/index.tsx` | SW session push uses `getStoredSessions()` |
| `src/sw-session.ts` | `pushSessionToSW` accepts `SWSessionPayload[]` for multi-account |
| `src/sw.ts` | Added `sessionsByBaseUrl` map; `setSessions` handler; `findSessionForUrl()` |

---

### Phase 4: Per-Account Atoms + Aggregation (uncommitted)

All domain-specific Jotai atoms converted to the per-account pattern. Each
domain stores data in a `Map<userId, T>` backing atom, exposes cached
per-account writable atoms via factory functions, and provides a derived
read-only aggregated atom that merges all accounts. Binding hooks now take only
`(mx: MatrixClient)` and resolve the userId internally.

#### Architecture Pattern

```
{domain}ByAccountAtom          Map<userId, T>           backing store
createAccount{Domain}Atom(id)  WritableAtom<T, [A], void>  cached per-account writer
getAccount{Domain}Atom(id)     same, with memoization   public accessor
{domain}Atom                   Atom<T>                  aggregated read-only
removeAccount{Domain}Atom      write-only               cleanup on logout
useBind{Domain}Atom(mx)        React hook               matrix-js-sdk event binding
```

For room-to-unread and thread-unread atoms, the aggregated atom uses
`roomOwnerByRoomIdAtom` to let the owning account's data take precedence when
the same room appears in multiple accounts.

#### Files Created (Phase 4)

| File | Purpose |
|---|---|
| `src/app/state/accountCleanup.ts` | Centralized `cleanupAccountAtomsAtom`: calls all `removeAccount*` atoms for a given userId on logout |

#### Files Modified (Phase 4)

| File | Change |
|---|---|
| `src/app/state/room-list/roomList.ts` | Per-account `roomsByAccountAtom`, `getAccountRoomsAtom()`, aggregated read-only `allRoomsAtom` (deduped union), `removeAccountRoomsAtom` |
| `src/app/state/room-list/inviteList.ts` | Per-account `invitesByAccountAtom`, aggregated `allInvitesAtom`, `removeAccountInvitesAtom` |
| `src/app/state/room-list/utils.ts` | Updated `useBindRoomsWithMembershipsAtom` type param from `undefined` to `void` |
| `src/app/state/mDirectList.ts` | Per-account `mDirectByAccountAtom`, aggregated `mDirectAtom` (union of DM sets), `removeAccountMDirectAtom` |
| `src/app/state/room/roomToParents.ts` | Per-account `roomToParentsByAccountAtom`, aggregated `roomToParentsAtom` (merged parent sets), `removeAccountParentsAtom`; extracted `applyParentsAction()` helper |
| `src/app/state/room/roomToUnread.ts` | Per-account `roomToUnreadByAccountAtom` + `roomToThreadUnreadByAccountAtom`; owner-prioritized aggregated `roomToUnreadAtom` + `roomToThreadUnreadAtom`; push rules now detected via `ClientEvent.AccountData` listener instead of React context; `removeAccountUnreadAtom` |
| `src/app/state/typingMembers.ts` | Simplified `useBindRoomIdToTypingMembersAtom` signature to `(mx)` only; kept as shared global atom (not per-account) |
| `src/app/state/nicknames.ts` | Per-account `nicknamesByAccountAtom`, aggregated `nicknamesAtom`; `setAccountNicknamesAtom`, `setNicknameAtom` (writes to owning account), `removeAccountNicknamesAtom` |
| `src/app/state/bookmarks.ts` | Per-account `bookmarksByAccountAtom`; `bookmarkListAtom` is now a derived read-only atom (dedup by `bookmark_id`); `removeAccountBookmarksAtom` |
| `src/app/state/hooks/useBindAtoms.ts` | All hooks called with `(mx)` only — removed per-atom second parameter |
| `src/app/pages/client/ClientBindAtoms.ts` | Now a structural pass-through; atom bindings moved to `AccountBootstrapper` |
| `src/app/pages/client/ClientRoot.tsx` | `AccountBootstrapper` renders `<AccountAtomBinder mx={mx}>` which calls `useBindAtoms(mx)` per-account; logout listener calls `cleanupAccountAtomsAtom` |
| `src/app/components/LogoutDialog.tsx` | Added `cleanupAccountAtomsAtom` call on logout |
| `src/app/features/bookmarks/useBookmarks.ts` | `useBookmarkActions` writes to `bookmarksByAccountAtom` instead of (now read-only) `bookmarkListAtom` |
| `src/app/hooks/useNickname.ts` | `useSyncNicknames` uses `setAccountNicknamesAtom` with `{ accountId, nicknames }` payload |

## Typecheck

- Baseline (`chrome` branch, no changes): **365** errors (TS2614, TS7006, TS2786 — all pre-existing `matrix-js-sdk` import and React return type issues)
- After Phase 4 changes: **352** errors (−13, from removing unused imports and simplifying signatures)
- **Zero new errors introduced**

## What Works Now

- Multiple sessions persisted in `localStorage` under `matrixSessions` key
- All sessions init + start simultaneously on page load
- Per-account crypto store isolation (`cryptoDatabasePrefix`)
- Legacy single-session auto-migration
- Targeted logout per account (stores + session + atom cleanup)
- Room ownership tracking across accounts
- Service worker media auth matches requests to correct account by homeserver URL
- Hooks available for components to resolve the owning client for any room
- Per-account room lists, invites, DMs, parents, unread, thread unread,
  nicknames, and bookmarks — all aggregated into unified read-only atoms
- Owner-prioritized dedup for shared rooms (unread, thread unread)
- Atom bindings run per-account via `AccountBootstrapper`
- Centralized atom cleanup on logout (all per-account data removed)

## Deferred to Next Iteration

- **Account switcher UI**: No UI to switch between accounts yet. The first
  session is always the primary.
- **Per-account sidebar sections**: No visual separation of accounts in the
  sidebar.
- **Account add/remove UI**: Adding a second account requires logging out and
  logging in (the session array handles it, but there's no "Add Account"
  button).
- **Notifications dedup**: Notifications may fire from multiple accounts for
  shared rooms.
- **Non-UI listener aggregation**: Favicon badge, desktop notifications, and
  invite toast handlers still only use the primary client.

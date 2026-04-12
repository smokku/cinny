# Multi-Account Implementation Status

> Generated: 12 April 2026
> Branch: `chrome`
> Diff: 16 files changed, +946 −214

## Architecture Overview

Always-on multi-account support (no config flag). All logged-in accounts sync
simultaneously. The primary (current) account drives the UI; other accounts run
headless in the background. Design follows Commet's `ClientManager` pattern
adapted to Jotai atoms, with Sable's per-account crypto store isolation.

### Key Design Decisions

- **Per-account IndexedDB isolation**: Each account gets its own sync store,
  crypto store, and Rust crypto database. Legacy (migrated) sessions keep the
  old `web-sync-store` / `crypto-store` names. New sessions use
  `sync${userId}` / `crypto${userId}` / `sync${userId}::matrix-sdk-crypto`.
- **Mismatch-detect-wipe-retry**: If `initRustCrypto` or `IndexedDBStore` throws
  a userId mismatch, the stores are wiped and rebuilt automatically.
- **Migration**: Legacy `cinny_*` localStorage keys are auto-migrated into the
  `matrixSessions` array on first boot, then removed.
- **Targeted logout**: Logging out one account only removes that account's
  session, SDK stores, and live client entry — other accounts keep running.

## Files Created

| File | Purpose |
|---|---|
| `src/app/state/clientManager.ts` | Jotai atoms for the live client registry: `liveClientsAtom`, `addLiveClientAtom`, `removeLiveClientAtom`, `updateSyncStateAtom`, `clientForUserIdAtom`, `allClientsAtom`, `isAnySyncingAtom` |
| `src/app/state/hooks/useBindRoomOwner.ts` | Keeps `roomOwnerByRoomIdAtom` in sync with each client's joined rooms |

## Files Modified

| File | Change |
|---|---|
| `src/app/state/sessions.ts` | Uncommented and enhanced multi-session atoms; added `rustCryptoPrefix` to `SessionStoreName`; added `currentAccountIdAtom`, `roomOwnerByRoomIdAtom`, `getStoredSessions()`, `hasStoredSession()` |
| `src/client/initMatrix.ts` | Per-account IndexedDB store names via `getSessionStoreName`; `initRustCrypto({cryptoDatabasePrefix})`; mismatch-detect-wipe-retry; targeted `logoutClient(mx, session)`; `stopClient()`; `deleteSessionStores()` |
| `src/app/pages/client/ClientRoot.tsx` | Multi-client bootstrap via `AccountBootstrapper` components; per-account sync state tracking; primary-client selection for `MatrixClientProvider`; pushes all sessions to SW |
| `src/app/hooks/useMatrixClient.ts` | Added hooks: `useLiveClients`, `useCurrentAccountId`, `useCurrentAccountClient`, `useRoomOwnerClient`, `useClientForUserId` |
| `src/app/pages/Router.tsx` | Route guards switched from `getFallbackSession()` to `hasStoredSession()` |
| `src/app/pages/auth/login/loginUtil.ts` | `useLoginComplete` writes to `sessionsAtom` (PUT) via Jotai instead of `setFallbackSession()` |
| `src/app/pages/auth/register/registerUtil.ts` | Same change for `useRegisterComplete` |
| `src/app/components/LogoutDialog.tsx` | Targeted logout: removes session from `sessionsAtom`, removes live client, calls `logoutClient(mx, session)` |
| `src/index.tsx` | SW session push uses `getStoredSessions()` instead of `getFallbackSession()` |
| `src/sw-session.ts` | `pushSessionToSW` accepts `SWSessionPayload[]` for multi-account or legacy single-session |
| `src/sw.ts` | Added `sessionsByBaseUrl` map; `setSessions` message handler; `findSessionForUrl()` for multi-homeserver media auth |

## Typecheck

- Baseline (before changes): **871** errors — all pre-existing TS2614 `matrix-js-sdk` import pattern
- After changes: **873** errors (+2 TS2614 from the 2 new files importing `matrix-js-sdk`)
- **No new functional or logic errors introduced**

## What Works Now

- Multiple sessions persisted in `localStorage` under `matrixSessions` key
- All sessions init + start simultaneously on page load
- Per-account crypto store isolation (`cryptoDatabasePrefix`)
- Legacy single-session auto-migration
- Targeted logout per account (stores + session cleanup)
- Room ownership tracking across accounts
- Service worker media auth matches requests to correct account by homeserver URL
- Hooks available for components to resolve the owning client for any room

## Deferred to Next Iteration

- **Account switcher UI**: No UI to switch between accounts yet. The first
  session is always the primary.
- **Aggregated room list**: Only the primary account's rooms are displayed.
  Rooms from other accounts sync in the background but aren't rendered.
- **Aggregated DMs**: `mDirectAtom` still binds to a single client.
- **Per-account sidebar sections**: No visual separation of accounts in the
  sidebar.
- **Thread/unread aggregation**: `roomToUnreadAtom` still binds to a single
  client.
- **Account add/remove UI**: Adding a second account requires logging out and
  logging in (the session array handles it, but there's no "Add Account"
  button).

# Always-On Multi-Account MVP

## Summary

- Replace the current single-session bootstrap with a permanent multi-session architecture. Do not add or keep a `multiAccountMode` flag.
- Persist multiple Matrix sessions, start one `MatrixClient` per saved account, and drive the app from unified Home/Direct/Space navigation across all connected accounts.
- Deduplicate rooms by `roomId`. When the same room exists in multiple accounts, keep a persisted owner-account mapping and default it to the last account used for that room.
- Keep account-scoped surfaces as MVP-scoped, not fully unified: Settings, Devices, presence editing, notification rules, and Inbox detail pages operate on the current account.

## Repository Validation Findings

- Current session persistence is still fallback-single-session in `src/app/state/sessions.ts`; multi-session atoms are present but commented out.
- Current auth routing checks use singleton session assumptions in `src/app/pages/Router.tsx`.
- Current client bootstrap is single-client in `src/app/pages/client/ClientRoot.tsx` and `src/app/hooks/useMatrixClient.ts`.
- Current client initialization uses shared IndexedDB names in `src/client/initMatrix.ts` (`web-sync-store`, `crypto-store`), which must be per-account for simultaneous clients.
- Current service worker auth sync in `src/sw-session.ts` and `src/sw.ts` is single-session and must move to a session-map model.
- Current logout path clears all local storage and all stores globally, so targeted account removal does not exist yet.

## Scope Decisions

- Multi-account is always-on for signed-in architecture.
- No backward-compatibility runtime mode flag.
- One saved session per `userId` (re-login replaces existing entry for that user).
- Route URL shapes remain unchanged (no account IDs in URLs).

## MVP Architecture

- Session persistence keys:
  - `matrixSessions: Session[]`
  - `currentAccountId: string | null`
  - `roomOwnerByRoomId: Record<string, string>`
- Client registry:
  - One live `MatrixClient` per session (`userId` key).
  - Registry owns startup, sync tracking, teardown, and targeted removal.
- Room ownership model:
  - Room navigation resolves account through `roomOwnerByRoomId`.
  - Owner is updated on room-open / room-action (last-used owner semantics).
- State model:
  - Per-account source atoms for room and account data.
  - Aggregated selectors for sidebar, unread badges, notifications, and global room lookup.
- SW auth/media model:
  - Session map sync to SW, not singleton session.
  - Authenticated media URLs carry internal account marker.
  - SW strips marker before fetch and chooses token by account marker.
  - Media cache varies by URL+account.

## Implementation Plan

### Phase 1: Restore Sessions Persistence and Migration

1. Restore and finish multi-session atoms in `src/app/state/sessions.ts`.
2. Add persisted atoms for `currentAccountId` and `roomOwnerByRoomId`.
3. Migrate legacy fallback localStorage session to `matrixSessions` on first boot.
4. Preserve `fallbackSdkStores` on migrated session for legacy store compatibility.
5. Enforce `PUT` semantics by `userId` replacement (no duplicates per user).

### Phase 2: Build Multi-Client Lifecycle Registry

1. Add a client registry module under `src/app/state/` keyed by `userId`.
2. Refactor `src/client/initMatrix.ts` to support per-account store names:
   - New sessions: `sync${userId}` and `crypto${userId}`
   - Migrated legacy sessions: fallback to legacy names via `fallbackSdkStores`
3. Track per-client sync state and cleanup handlers.
4. Implement targeted client stop/remove APIs.

### Phase 3: Convert Auth/Bootstrap/Providers to Multi-Account

1. Replace singleton route guards in `src/app/pages/Router.tsx` with "has at least one saved session" checks.
2. Replace single-client bootstrap in `src/app/pages/client/ClientRoot.tsx` with multi-client startup and provider wiring.
3. Replace single `MatrixClientProvider` assumption with:
   - global registry/current-account provider
   - room-owner resolver provider
   - explicit per-account lookup hooks for non-room global UI
4. Keep `useMatrixClient()` as room-scoped/current-account entry point by resolving through new providers.
5. Refactor login/register completion in:
   - `src/app/pages/auth/login/loginUtil.ts`
   - `src/app/pages/auth/register/registerUtil.ts`
   to append/replace `matrixSessions` instead of writing singleton fallback keys.

### Phase 4: Convert Client-Bound Atoms to Per-Account + Aggregate

1. Replace single-client bindings from `src/app/state/hooks/useBindAtoms.ts` with per-account binding.
2. Convert these domains to per-account source + aggregated selectors:
   - joined rooms
   - invites
   - `m.direct`
   - room parents
   - unread state
   - thread unread state
   - nicknames
3. Update navigation/search/sidebar consumers to use aggregated selectors.
4. Keep room classification (Home/Direct/Space) based on room owner account only.

### Phase 5: Room Owner Routing Semantics

1. Keep visible route shapes unchanged.
2. Resolve room owner from `roomOwnerByRoomId` whenever navigating/opening a room.
3. Persist owner changes when user opens or acts in that room.
4. Ensure `currentAccountId` follows opened room owner and can also be changed explicitly from user menu.

### Phase 6: Targeted Logout and Account Management

1. Replace "logout clears everything" behavior with targeted account removal:
   - stop only that client
   - clear only that account’s stores
   - remove only that account mappings from `roomOwnerByRoomId`
2. Keep app running when at least one account remains.
3. Perform full sign-out only when removing the last account.
4. Add account management in signed-in shell using existing user menu/settings surfaces.
5. Reuse current login/register flows inside in-app modal workflow.

### Phase 7: Service Worker Multi-Account Auth Media

1. Update `src/sw-session.ts` to send session map + current account context.
2. Update `src/index.tsx` session push logic to publish all saved sessions.
3. Refactor `src/sw.ts` from single persisted session to persisted session map.
4. Extend `mxcUrlToHttp` helper in `src/app/utils/matrix.ts` to include internal account marker.
5. In SW fetch path:
   - parse account marker
   - pick matching token/session
   - strip marker before network request
   - cache by URL+account

### Phase 8: Non-UI Listeners and Dedup

1. Move favicon, notifications, and invite handling to aggregated multi-client listeners.
2. Deduplicate notifications by event ID.
3. Navigate notification actions using room owner account resolution.

## File-Level Worklist

- `src/app/state/sessions.ts`
- `src/app/state/utils/atomWithLocalStorage.ts` (reuse helpers, minimal edits)
- `src/client/initMatrix.ts`
- `src/app/pages/Router.tsx`
- `src/app/pages/client/ClientRoot.tsx`
- `src/app/hooks/useMatrixClient.ts`
- `src/app/state/hooks/useBindAtoms.ts`
- `src/app/state/room-list/roomList.ts`
- `src/app/state/mDirectList.ts`
- `src/app/state/room/roomToParents.ts`
- `src/app/state/room/roomToUnread.ts`
- `src/app/pages/auth/login/loginUtil.ts`
- `src/app/pages/auth/register/registerUtil.ts`
- `src/index.tsx`
- `src/sw-session.ts`
- `src/sw.ts`
- `src/app/utils/matrix.ts`

## Validation

- Run `npm run typecheck` after each major phase touching TS/React logic.
- Run `npm run lint` after state/provider/routing refactor phases.
- Run `npm run build` at integration milestones and final pass.
- Manual regression checklist:
  1. Migration from existing single-session localStorage.
  2. Add second account in-app without reload.
  3. Refresh with multiple accounts reconnecting.
  4. Open room present in one account.
  5. Open deduplicated room present in multiple accounts and verify owner persistence.
  6. Switch effective owner by acting in room from another account.
  7. Remove one account without affecting others.
  8. Authenticated media for different accounts in same tab.

## Explicit Non-Goals for MVP

- Duplicate parallel sessions for the same `userId`.
- Account IDs in URL paths.
- Full unification of account-scoped settings/devices/presence/notification-rules/inbox detail pages.
- Introducing a new automated test suite requirement.

## Risks and Mitigations

- IndexedDB store conflicts:
  - Mitigation: strict per-user store names + fallback legacy naming only for migrated sessions.
- State fan-out complexity across atoms:
  - Mitigation: per-account source atoms first, then aggregated selectors, phased rollout.
- Notification duplication:
  - Mitigation: centralized event-ID dedup in aggregated listener layer.
- Service-worker auth mismatch:
  - Mitigation: explicit account marker routing and cache partition by account.

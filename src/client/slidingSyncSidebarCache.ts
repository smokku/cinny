import {
  EventType,
  KnownMembership,
  MatrixClient,
  MatrixEvent,
  UNSTABLE_ELEMENT_FUNCTIONAL_USERS,
} from 'matrix-js-sdk';
import { MSC3575RoomData, SlidingSync, SlidingSyncEvent } from 'matrix-js-sdk/lib/sliding-sync';
import { AccountDataEvent } from '../types/matrix/accountData';
import { StateEvent } from '../types/matrix/room';

const CACHE_VERSION = 1;
const SIDEBAR_CACHE_KEY_PREFIX = 'cinny.slidingSyncSidebarCache.';
const CACHE_WRITE_DELAY_MS = 500;
const MAX_CACHED_ROOMS = 2000;
const HYDRATION_BATCH_SIZE = 50;

type IdleWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

type CachedStateEvent = MSC3575RoomData['required_state'][number];

type SidebarCacheData = {
  version: number;
  rooms: Record<string, MSC3575RoomData>;
  accountData: Record<string, Record<string, unknown>>;
};

const CACHED_ACCOUNT_DATA_TYPES = new Set<string>([
  AccountDataEvent.Direct,
  AccountDataEvent.CinnySpaces,
]);

const CACHED_STATE_TYPES = new Set<string>([
  EventType.RoomCreate,
  EventType.RoomName,
  EventType.RoomTopic,
  EventType.RoomAvatar,
  EventType.RoomCanonicalAlias,
  EventType.RoomJoinRules,
  EventType.RoomHistoryVisibility,
  EventType.RoomGuestAccess,
  EventType.RoomEncryption,
  EventType.RoomTombstone,
  EventType.RoomPowerLevels,
  EventType.RoomPinnedEvents,
  EventType.RoomServerAcl,
  EventType.SpaceChild,
  EventType.SpaceParent,
  UNSTABLE_ELEMENT_FUNCTIONAL_USERS.name,
  StateEvent.PowerLevelTags,
  StateEvent.RoomBanner,
  'im.vector.modular.widgets',
]);

const emptyCache = (): SidebarCacheData => ({
  version: CACHE_VERSION,
  rooms: {},
  accountData: {},
});

const stateEventKey = (event: CachedStateEvent): string => `${event.type}\u0000${event.state_key}`;

const mergeStateEvents = (
  previous: CachedStateEvent[] | undefined,
  incoming: CachedStateEvent[] | undefined,
  userId: string
): CachedStateEvent[] => {
  const merged = new Map<string, CachedStateEvent>();
  previous?.forEach((event) => merged.set(stateEventKey(event), event));
  incoming?.forEach((event) => {
    const cacheMember = event.type === EventType.RoomMember && event.state_key === userId;
    if (cacheMember || CACHED_STATE_TYPES.has(event.type)) {
      merged.set(stateEventKey(event), event);
    }
  });
  return [...merged.values()];
};

const selfMembership = (
  events: CachedStateEvent[] | undefined,
  userId: string
): string | undefined => {
  const event = events?.find((e) => e.type === EventType.RoomMember && e.state_key === userId);
  const content = event?.content;
  return content && typeof content === 'object'
    ? (content as { membership?: string }).membership
    : undefined;
};

// The SDK derives an invite from invite_state and ignores required_state, so a
// server that keeps sending invite_state after a join (Continuwuity) would
// resurrect a stale invite. required_state membership is authoritative here.
const resolveInviteState = (
  requiredState: CachedStateEvent[] | undefined,
  inviteState: CachedStateEvent[] | undefined,
  userId: string
): CachedStateEvent[] | undefined =>
  selfMembership(requiredState, userId) === KnownMembership.Join ? undefined : inviteState;

const mergeRoomData = (
  previous: MSC3575RoomData | undefined,
  incoming: MSC3575RoomData,
  userId: string
): MSC3575RoomData => {
  const requiredState = mergeStateEvents(previous?.required_state, incoming.required_state, userId);
  const inviteState = incoming.invite_state
    ? mergeStateEvents(previous?.invite_state, incoming.invite_state, userId)
    : previous?.invite_state;

  return {
    ...previous,
    ...incoming,
    name: incoming.name ?? previous?.name ?? '',
    heroes: incoming.heroes ?? previous?.heroes,
    notification_count: incoming.notification_count ?? previous?.notification_count,
    highlight_count: incoming.highlight_count ?? previous?.highlight_count,
    joined_count: incoming.joined_count ?? previous?.joined_count,
    invited_count: incoming.invited_count ?? previous?.invited_count,
    is_dm: incoming.is_dm ?? previous?.is_dm,
    bump_stamp: incoming.bump_stamp ?? previous?.bump_stamp,
    required_state: requiredState,
    invite_state: resolveInviteState(requiredState, inviteState, userId),
    timeline: [],
    initial: true,
    limited: false,
    num_live: 0,
    prev_batch: undefined,
  };
};

const parseCache = (value: string | null): SidebarCacheData => {
  if (!value) return emptyCache();
  try {
    const parsed = JSON.parse(value) as Partial<SidebarCacheData>;
    if (parsed.version !== CACHE_VERSION || !parsed.rooms || !parsed.accountData) {
      return emptyCache();
    }
    return parsed as SidebarCacheData;
  } catch {
    return emptyCache();
  }
};

const hydrateRoomBatch = async (
  slidingSync: SlidingSync,
  rooms: [string, MSC3575RoomData][],
  startIndex = 0
): Promise<void> => {
  const batch = rooms.slice(startIndex, startIndex + HYDRATION_BATCH_SIZE);
  await Promise.all(
    batch.map(([roomId, roomData]) =>
      slidingSync.emitPromised(SlidingSyncEvent.RoomData, roomId, roomData)
    )
  );
  if (startIndex + HYDRATION_BATCH_SIZE < rooms.length) {
    await hydrateRoomBatch(slidingSync, rooms, startIndex + HYDRATION_BATCH_SIZE);
  }
};

/**
 * Persists the room list data sliding sync delivers (names, avatars, space
 * structure, own membership and counts, but no timelines), so the sidebar can
 * be rendered from it on the next start before the first response arrives.
 */
export class SlidingSyncSidebarCache {
  public static clear(userId: string): void {
    try {
      localStorage.removeItem(`${SIDEBAR_CACHE_KEY_PREFIX}${encodeURIComponent(userId)}`);
    } catch {
      // Storage can be disabled for this origin.
    }
  }

  private readonly storageKey: string;

  private data: SidebarCacheData;

  private writeTimer: ReturnType<typeof setTimeout> | undefined;

  private idleWriteHandle: number | undefined;

  public constructor(private readonly userId: string) {
    this.storageKey = `${SIDEBAR_CACHE_KEY_PREFIX}${encodeURIComponent(userId)}`;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(this.storageKey);
    } catch {
      // Storage can be disabled for this origin.
    }
    this.data = parseCache(stored);
  }

  public cacheRoom(roomId: string, roomData: MSC3575RoomData): void {
    this.data.rooms[roomId] = mergeRoomData(this.data.rooms[roomId], roomData, this.userId);
    this.scheduleWrite();
  }

  public removeRoom(roomId: string): void {
    if (!this.data.rooms[roomId]) return;
    delete this.data.rooms[roomId];
    this.scheduleWrite();
  }

  public reconcileRooms(validRoomIds: ReadonlySet<string>): string[] {
    const removedRoomIds = Object.keys(this.data.rooms).filter(
      (roomId) => !validRoomIds.has(roomId)
    );
    if (removedRoomIds.length === 0) return removedRoomIds;

    removedRoomIds.forEach((roomId) => delete this.data.rooms[roomId]);
    this.scheduleWrite();
    return removedRoomIds;
  }

  // Backstop for rooms the server confirms joined but whose required_state still
  // reads invite (e.g. joined on another client), which resolveInviteState misses.
  public clearInviteStateForRooms(roomIds: readonly string[]): void {
    let changed = false;
    roomIds.forEach((roomId) => {
      const room = this.data.rooms[roomId];
      if (room?.invite_state !== undefined) {
        room.invite_state = undefined;
        changed = true;
      }
    });
    if (changed) this.scheduleWrite();
  }

  // Heal a cache that persisted invite_state for a room required_state already
  // shows as joined, so recovery happens offline on hydration.
  private sanitizeInviteState(): void {
    let changed = false;
    Object.values(this.data.rooms).forEach((room) => {
      if (room.invite_state === undefined) return;
      if (resolveInviteState(room.required_state, room.invite_state, this.userId) === undefined) {
        // eslint-disable-next-line no-param-reassign
        room.invite_state = undefined;
        changed = true;
      }
    });
    if (changed) this.scheduleWrite();
  }

  public cacheAccountData(event: MatrixEvent): void {
    if (!CACHED_ACCOUNT_DATA_TYPES.has(event.getType())) return;
    this.data.accountData[event.getType()] = event.getContent<Record<string, unknown>>();
    this.scheduleWrite();
  }

  public async hydrate(mx: MatrixClient, slidingSync: SlidingSync): Promise<boolean> {
    this.sanitizeInviteState();
    const rooms = Object.entries(this.data.rooms);
    const accountData = Object.entries(this.data.accountData);
    if (rooms.length === 0 && accountData.length === 0) return false;

    if (accountData.length > 0) {
      mx.store.storeAccountDataEvents(
        accountData.map(([type, content]) => new MatrixEvent({ type, content }))
      );
    }

    await hydrateRoomBatch(slidingSync, rooms);
    return rooms.length > 0;
  }

  public dispose(): void {
    let shouldWrite = false;
    if (this.writeTimer !== undefined) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
      shouldWrite = true;
    }
    if (this.idleWriteHandle !== undefined) {
      (window as IdleWindow).cancelIdleCallback?.(this.idleWriteHandle);
      this.idleWriteHandle = undefined;
      shouldWrite = true;
    }
    if (shouldWrite) this.write();
  }

  private scheduleWrite(): void {
    if (this.writeTimer !== undefined || this.idleWriteHandle !== undefined) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      const idleWindow = window as IdleWindow;
      if (typeof idleWindow.requestIdleCallback === 'function') {
        this.idleWriteHandle = idleWindow.requestIdleCallback(
          () => {
            this.idleWriteHandle = undefined;
            this.write();
          },
          { timeout: 2000 }
        );
        return;
      }
      this.write();
    }, CACHE_WRITE_DELAY_MS);
  }

  private write(): void {
    const sortedRooms = Object.entries(this.data.rooms)
      .sort(([, a], [, b]) => (b.bump_stamp ?? 0) - (a.bump_stamp ?? 0))
      .slice(0, MAX_CACHED_ROOMS);

    // Halve the persisted rooms until the cache fits the storage quota.
    const tryWrite = (rooms: [string, MSC3575RoomData][]): void => {
      const nextData = { ...this.data, rooms: Object.fromEntries(rooms) };
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(nextData));
        this.data = nextData;
      } catch {
        if (rooms.length <= 1) return;
        tryWrite(rooms.slice(0, Math.floor(rooms.length / 2)));
      }
    };
    tryWrite(sortedRooms);
  }
}

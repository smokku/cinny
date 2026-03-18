/* eslint-disable max-classes-per-file */
import { ClientEvent, MatrixClient, EventType, User } from 'matrix-js-sdk';
import {
  Extension,
  ExtensionState,
  MSC3575List,
  MSC3575RoomData,
  MSC3575RoomSubscription,
  MSC3575_WILDCARD,
  SlidingSync,
  SlidingSyncEvent,
  SlidingSyncState,
  MSC3575_STATE_KEY_LAZY,
  MSC3575_STATE_KEY_ME,
} from 'matrix-js-sdk/lib/sliding-sync';
import { quietMatrixLogger } from './matrixLogger';

const log = quietMatrixLogger.getChild('slidingSync');

export const LIST_JOINED = 'joined';
export const LIST_INVITES = 'invites';
export const LIST_DMS = 'dms';
export const LIST_SEARCH = 'search';
// Separate key for live room-name filtering; avoids conflicting with the spidering list.
export const LIST_ROOM_SEARCH = 'room_search';
// Dynamic list key used for space-scoped room views.
export const LIST_SPACE = 'space';
// One event of timeline per list room is enough to compute unread counts;
// the full history is loaded when the user opens the room.
const LIST_TIMELINE_LIMIT = 1;
const DEFAULT_LIST_PAGE_SIZE = 250;
const DEFAULT_POLL_TIMEOUT_MS = 20000;
const DEFAULT_MAX_ROOMS = 5000;

// Sort order for MSC4186 (Simplified Sliding Sync): most recently active first,
// then alphabetical as a tiebreaker. by_notification_level is MSC3575-only and
// not supported by Synapse's native MSC4186 implementation.
const LIST_SORT_ORDER = ['by_recency', 'by_name'];

// Subscription key for the room the user is actively viewing.
// Encrypted rooms get [*,*] required_state; unencrypted rooms also request lazy members.
const UNENCRYPTED_SUBSCRIPTION_KEY = 'unencrypted';
// Adaptive timeline limits for the room the user is actively viewing.
// Lower limits reduce initial bandwidth on constrained devices/connections;
// the user can always paginate further once the room is open.
// These values must be high enough to ensure proper timeline initialization and pagination tokens.
const ACTIVE_ROOM_TIMELINE_LIMIT_LOW = 50;
const ACTIVE_ROOM_TIMELINE_LIMIT_MEDIUM = 100;
const ACTIVE_ROOM_TIMELINE_LIMIT_HIGH = 150;

export type PartialSlidingSyncRequest = {
  filters?: MSC3575List['filters'];
  sort?: string[];
  ranges?: [number, number][];
};

export type SlidingSyncConfig = {
  enabled?: boolean | string | number;
  proxyBaseUrl?: string;
  bootstrapClassicOnColdCache?: boolean;
  listPageSize?: number;
  timelineLimit?: number;
  pollTimeoutMs?: number;
  maxRooms?: number;
  includeInviteList?: boolean;
  probeTimeoutMs?: number;
};

export type SlidingSyncListDiagnostics = {
  key: string;
  knownCount: number;
  rangeEnd: number;
};

export type SlidingSyncDiagnostics = {
  proxyBaseUrl: string;
  timelineLimit: number;
  adaptiveTimeline: boolean;
  listPageSize: number;
  lists: SlidingSyncListDiagnostics[];
};

const clampPositive = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return fallback;
  return Math.round(value);
};

type AdaptiveSignals = {
  saveData: boolean;
  effectiveType: string | null;
  deviceMemoryGb: number | null;
  mobile: boolean;
  missingSignals: number;
};

const readAdaptiveSignals = (): AdaptiveSignals => {
  const navigatorLike = typeof navigator !== 'undefined' ? navigator : undefined;
  const connection = (navigatorLike as any)?.connection;
  const effectiveType = connection?.effectiveType;
  const deviceMemory = (navigatorLike as any)?.deviceMemory;
  const uaMobile = (navigatorLike as any)?.userAgentData?.mobile;
  const fallbackMobileUA = navigatorLike?.userAgent ?? '';
  const mobileByUA =
    typeof uaMobile === 'boolean'
      ? uaMobile
      : /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(fallbackMobileUA);
  const saveData = connection?.saveData === true;
  const normalizedEffectiveType = typeof effectiveType === 'string' ? effectiveType : null;
  const normalizedDeviceMemory = typeof deviceMemory === 'number' ? deviceMemory : null;
  const missingSignals =
    Number(normalizedEffectiveType === null) + Number(normalizedDeviceMemory === null);
  return {
    saveData,
    effectiveType: normalizedEffectiveType,
    deviceMemoryGb: normalizedDeviceMemory,
    mobile: mobileByUA,
    missingSignals,
  };
};

// Resolve the timeline limit for the active-room subscription based on device/network.
// The list subscription always uses LIST_TIMELINE_LIMIT=1 regardless of conditions.
const resolveAdaptiveRoomTimelineLimit = (
  configuredLimit: number | undefined,
  signals: AdaptiveSignals
): number => {
  if (typeof configuredLimit === 'number' && configuredLimit > 0) {
    return clampPositive(configuredLimit, ACTIVE_ROOM_TIMELINE_LIMIT_HIGH);
  }
  if (signals.saveData || signals.effectiveType === 'slow-2g' || signals.effectiveType === '2g') {
    return ACTIVE_ROOM_TIMELINE_LIMIT_LOW;
  }
  if (
    signals.effectiveType === '3g' ||
    (signals.deviceMemoryGb !== null && signals.deviceMemoryGb <= 4)
  ) {
    return ACTIVE_ROOM_TIMELINE_LIMIT_MEDIUM;
  }
  if (signals.mobile && signals.missingSignals > 0) {
    return ACTIVE_ROOM_TIMELINE_LIMIT_MEDIUM;
  }
  return ACTIVE_ROOM_TIMELINE_LIMIT_HIGH;
};

// Minimal required_state for list entries; enough to render the room list sidebar,
// compute unread state, and build the space hierarchy without fetching full room history.
const buildListRequiredState = (): MSC3575RoomSubscription['required_state'] => [
  [EventType.RoomJoinRules, ''],
  [EventType.RoomAvatar, ''],
  [EventType.RoomTombstone, ''],
  [EventType.RoomEncryption, ''],
  [EventType.RoomCreate, ''],
  [EventType.RoomTopic, ''],
  [EventType.RoomCanonicalAlias, ''],
  [EventType.RoomMember, MSC3575_STATE_KEY_ME],
  ['m.space.child', MSC3575_WILDCARD],
  ['im.ponies.room_emotes', MSC3575_WILDCARD],
];

// For an active encrypted room: fetch everything so the client can decrypt all events.
const buildEncryptedSubscription = (timelineLimit: number): MSC3575RoomSubscription => ({
  timeline_limit: timelineLimit,
  required_state: [[MSC3575_WILDCARD, MSC3575_WILDCARD]],
});

// For an active unencrypted room: fetch everything, plus explicit lazy+ME members so
// the member list and display names are always available.
const buildUnencryptedSubscription = (timelineLimit: number): MSC3575RoomSubscription => ({
  timeline_limit: timelineLimit,
  required_state: [
    [MSC3575_WILDCARD, MSC3575_WILDCARD],
    [EventType.RoomMember, MSC3575_STATE_KEY_ME],
    [EventType.RoomMember, MSC3575_STATE_KEY_LAZY],
  ],
});

const buildLists = (pageSize: number, includeInviteList: boolean): Map<string, MSC3575List> => {
  const lists = new Map<string, MSC3575List>();
  const listRequiredState = buildListRequiredState();

  // Start with a reasonable initial range that will quickly expand to full list
  // Since timeline_limit=1, loading many rooms is very cheap
  const initialRange = Math.min(pageSize, 100);

  lists.set(LIST_JOINED, {
    ranges: [[0, Math.max(0, initialRange - 1)]],
    sort: LIST_SORT_ORDER,
    timeline_limit: LIST_TIMELINE_LIMIT,
    required_state: listRequiredState,
    slow_get_all_rooms: true,
    filters: { is_invite: false },
  });

  if (includeInviteList) {
    lists.set(LIST_INVITES, {
      ranges: [[0, Math.max(0, initialRange - 1)]],
      sort: LIST_SORT_ORDER,
      timeline_limit: LIST_TIMELINE_LIMIT,
      required_state: listRequiredState,
      slow_get_all_rooms: true,
      filters: { is_invite: true },
    });
  }

  lists.set(LIST_DMS, {
    ranges: [[0, Math.max(0, initialRange - 1)]],
    sort: LIST_SORT_ORDER,
    timeline_limit: LIST_TIMELINE_LIMIT,
    required_state: listRequiredState,
    slow_get_all_rooms: true,
    filters: { is_dm: true },
  });

  return lists;
};

const getListEndIndex = (list: MSC3575List | null): number => {
  if (!list?.ranges?.length) return -1;
  return list.ranges.reduce((max, range) => Math.max(max, range[1] ?? -1), -1);
};

// MSC4186 presence extension: requests `extensions.presence` in every sliding sync
// poll and feeds received `m.presence` events into the SDK's User objects so that
// components using `useUserPresence` see live updates (same path as regular /sync).
class ExtensionPresence implements Extension<{ enabled: boolean }, { events?: object[] }> {
  private enabled = true;

  public constructor(private readonly mx: MatrixClient) {}

  public setEnabled(value: boolean): void {
    this.enabled = value;
  }

  // eslint-disable-next-line class-methods-use-this
  public name(): string {
    return 'presence';
  }

  // eslint-disable-next-line class-methods-use-this
  public when(): ExtensionState {
    // Run after the main response body has been processed so room/member state is ready.
    return ExtensionState.PostProcess;
  }

  public async onRequest(): Promise<{ enabled: boolean }> {
    return { enabled: this.enabled };
  }

  public async onResponse(data: { events?: object[] }): Promise<void> {
    if (!data?.events?.length) return;
    const mapper = this.mx.getEventMapper();
    data.events.forEach((rawEvent) => {
      const event = mapper(rawEvent as Parameters<typeof mapper>[0]);
      const userId = event.getSender() ?? (event.getContent().user_id as string | undefined);
      if (!userId) return;
      let user = this.mx.store.getUser(userId);
      if (user) {
        user.setPresenceEvent(event);
      } else {
        user = User.createUser(userId, this.mx);
        user.setPresenceEvent(event);
        this.mx.store.storeUser(user);
      }
      this.mx.emit(ClientEvent.Event, event);
    });
  }
}

export class SlidingSyncManager {
  private disposed = false;

  private readonly maxRooms: number;

  private readonly listKeys: string[];

  private readonly activeRoomSubscriptions = new Set<string>();

  private readonly listPageSize: number;

  private roomTimelineLimit: number;

  private readonly adaptiveTimeline: boolean;

  private readonly configuredTimelineLimit?: number;

  private readonly onConnectionChange: () => void;

  private readonly onLifecycle: (state: SlidingSyncState, resp: unknown, err?: Error) => void;

  private presenceExtension!: ExtensionPresence;

  private listsFullyLoaded = false;

  private initialSyncCompleted = false;

  private syncCount = 0;

  private previousListCounts: Map<string, number> = new Map();

  /**
   * One-shot RoomData listeners keyed by roomId, used to detect
   * when the first data arrives for a subscribed room.
   * Cleaned up automatically after first fire or on unsubscribe/dispose.
   */
  private readonly pendingRoomDataListeners = new Map<
    string,
    (roomId: string, data: MSC3575RoomData) => void
  >();

  public readonly slidingSync: SlidingSync;

  public readonly probeTimeoutMs: number;

  public constructor(
    private readonly mx: MatrixClient,
    private readonly proxyBaseUrl: string,
    config: SlidingSyncConfig
  ) {
    const listPageSize = clampPositive(config.listPageSize, DEFAULT_LIST_PAGE_SIZE);
    const pollTimeoutMs = clampPositive(config.pollTimeoutMs, DEFAULT_POLL_TIMEOUT_MS);
    this.probeTimeoutMs = clampPositive(config.probeTimeoutMs, 5000);
    this.maxRooms = clampPositive(config.maxRooms, DEFAULT_MAX_ROOMS);
    this.listPageSize = listPageSize;
    const includeInviteList = config.includeInviteList !== false;

    const adaptiveTimeline = !(
      typeof config.timelineLimit === 'number' && config.timelineLimit > 0
    );
    const signals = readAdaptiveSignals();
    const roomTimelineLimit = resolveAdaptiveRoomTimelineLimit(config.timelineLimit, signals);
    this.adaptiveTimeline = adaptiveTimeline;
    this.roomTimelineLimit = roomTimelineLimit;
    this.configuredTimelineLimit = config.timelineLimit;

    const defaultSubscription = buildEncryptedSubscription(roomTimelineLimit);
    const lists = buildLists(listPageSize, includeInviteList);
    this.listKeys = Array.from(lists.keys());
    this.slidingSync = new SlidingSync(proxyBaseUrl, lists, defaultSubscription, mx, pollTimeoutMs);

    // Register the presence extension so m.presence events from the server are fed
    // into the SDK's User objects, keeping useUserPresence accurate during sliding sync.
    this.presenceExtension = new ExtensionPresence(mx);
    this.slidingSync.registerExtension(this.presenceExtension);

    // Register a custom subscription for unencrypted active rooms; encrypted rooms use
    // the default subscription (which already has [*,*]).
    this.slidingSync.addCustomSubscription(
      UNENCRYPTED_SUBSCRIPTION_KEY,
      buildUnencryptedSubscription(roomTimelineLimit)
    );

    this.onLifecycle = (state, resp, err) => {
      this.syncCount += 1;

      if (err) {
        log.error('Sliding sync error', err.message);
      }

      if (this.disposed) return;
      if (err || !resp || state !== SlidingSyncState.Complete) return;

      if (!this.initialSyncCompleted) {
        this.initialSyncCompleted = true;
        log.info(`Initial sync completed (cycle #${this.syncCount})`);
      }

      this.expandListsToKnownCount();
    };

    this.onConnectionChange = () => {
      if (this.disposed || !this.adaptiveTimeline) return;
      const nextLimit = resolveAdaptiveRoomTimelineLimit(
        this.configuredTimelineLimit,
        readAdaptiveSignals()
      );
      if (nextLimit === this.roomTimelineLimit) return;
      this.roomTimelineLimit = nextLimit;
      this.applyRoomTimelineLimit(nextLimit);
      log.info(`Adaptive room timeline updated to ${nextLimit}`);
    };
  }

  public attach(): void {
    (this.slidingSync as any).on(SlidingSyncEvent.Lifecycle, this.onLifecycle);
    const connection = (
      typeof navigator !== 'undefined' ? (navigator as any).connection : undefined
    ) as
      | {
          addEventListener?: (e: string, cb: () => void) => void;
          removeEventListener?: (e: string, cb: () => void) => void;
          onchange?: (() => void) | null;
        }
      | undefined;
    connection?.addEventListener?.('change', this.onConnectionChange);
    if (connection && connection.onchange === null) connection.onchange = this.onConnectionChange;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onConnectionChange);
      window.addEventListener('offline', this.onConnectionChange);
    }
  }

  public dispose(): void {
    if (this.disposed) return;

    // Clean up pending room-data latency listeners before marking disposed.
    // SlidingSync.stop() will removeAllListeners anyway, but this keeps the Map tidy.
    this.pendingRoomDataListeners.clear();

    this.disposed = true;
    (this.slidingSync as any).removeListener(SlidingSyncEvent.Lifecycle, this.onLifecycle);
    const connection = (
      typeof navigator !== 'undefined' ? (navigator as any).connection : undefined
    ) as
      | {
          addEventListener?: (e: string, cb: () => void) => void;
          removeEventListener?: (e: string, cb: () => void) => void;
          onchange?: (() => void) | null;
        }
      | undefined;
    connection?.removeEventListener?.('change', this.onConnectionChange);
    if (connection?.onchange === this.onConnectionChange) connection.onchange = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onConnectionChange);
      window.removeEventListener('offline', this.onConnectionChange);
    }
  }

  private applyRoomTimelineLimit(timelineLimit: number): void {
    this.slidingSync.modifyRoomSubscriptionInfo(buildEncryptedSubscription(timelineLimit));
    this.slidingSync.addCustomSubscription(
      UNENCRYPTED_SUBSCRIPTION_KEY,
      buildUnencryptedSubscription(timelineLimit)
    );
  }

  public setPresenceEnabled(enabled: boolean): void {
    this.presenceExtension.setEnabled(enabled);
  }

  public getDiagnostics(): SlidingSyncDiagnostics {
    return {
      proxyBaseUrl: this.proxyBaseUrl,
      timelineLimit: this.roomTimelineLimit,
      adaptiveTimeline: this.adaptiveTimeline,
      listPageSize: this.listPageSize,
      lists: this.listKeys.map((key) => {
        const listData = this.slidingSync.getListData(key);
        const params = this.slidingSync.getListParams(key);
        return {
          key,
          knownCount: listData?.joinedCount ?? 0,
          rangeEnd: getListEndIndex(params),
        };
      }),
    };
  }

  private expandListsToKnownCount(): void {
    // Stop expanding once we've loaded all rooms - prevents continuous updates
    if (this.listsFullyLoaded) return;

    let allListsComplete = true;

    this.listKeys.forEach((key) => {
      const listData = this.slidingSync.getListData(key);
      const knownCount = listData?.joinedCount ?? 0;
      if (knownCount <= 0) return;

      const existing = this.slidingSync.getListParams(key);
      const currentEnd = getListEndIndex(existing);

      // Calculate how many rooms we still need to load
      const maxEnd = Math.min(knownCount, this.maxRooms) - 1;

      if (currentEnd >= maxEnd) return;

      allListsComplete = false;

      // Progressive expansion: load in moderate chunks to balance speed with stability
      const chunkSize = 100;
      const desiredEnd = Math.min(currentEnd + chunkSize, maxEnd);

      if (desiredEnd === currentEnd) return;

      this.slidingSync.setListRanges(key, [[0, desiredEnd]]);

      if (knownCount > this.maxRooms) {
        log.warn(`List "${key}" capped at ${this.maxRooms}/${knownCount} rooms`);
      }
    });

    // Mark as fully loaded once all lists are complete
    if (allListsComplete) {
      this.listsFullyLoaded = true;
      log.info(`All lists fully loaded for ${this.mx.getUserId()}`);
    }
  }

  /**
   * Ensure a dynamic list is registered (or updated) on the sliding sync session.
   * If the list does not yet exist it is created with sensible defaults merged with
   * `updateArgs`. If it already exists and the merged result differs, only the ranges
   * are updated (cheaper — avoids resending sticky params) when `updateArgs` only
   * contains `ranges`; otherwise the full list is replaced.
   */
  public ensureListRegistered(listKey: string, updateArgs: PartialSlidingSyncRequest): MSC3575List {
    let list = this.slidingSync.getListParams(listKey);
    if (!list) {
      list = {
        ranges: [[0, 20]],
        sort: LIST_SORT_ORDER,
        timeline_limit: LIST_TIMELINE_LIMIT,
        required_state: buildListRequiredState(),
        ...updateArgs,
      };
    } else {
      const updated = { ...list, ...updateArgs };
      if (JSON.stringify(list) === JSON.stringify(updated)) return list;
      list = updated;
    }

    try {
      if (updateArgs.ranges && Object.keys(updateArgs).length === 1) {
        this.slidingSync.setListRanges(listKey, updateArgs.ranges);
      } else {
        this.slidingSync.setList(listKey, list);
      }
    } catch {
      // ignore — the list will be re-sent on the next sync cycle
    }
    return this.slidingSync.getListParams(listKey) ?? list;
  }

  /**
   * Spider through all rooms by incrementally expanding the search list, matching
   * Element Web's `startSpidering` behaviour. Called once after `attach()` and runs
   * in the background; callers must not await it.
   */
  public async startSpidering(batchSize: number, gapBetweenRequestsMs: number): Promise<void> {
    // Delay before the first request — startSpidering is called right after attach(),
    // so give the initial sync a moment to settle first.
    await new Promise<void>((res) => {
      setTimeout(res, gapBetweenRequestsMs);
    });
    if (this.disposed) return;

    // Use a single expanding range [[0, endIndex]] rather than a two-range sliding
    // window. Synapse's extension handler asserts len(actual_list.ops) == 1, which
    // fails when the response contains multiple ops (one per range). A single range
    // always produces a single SYNC op, avoiding the assertion.
    let endIndex = batchSize - 1;
    let hasMore = true;
    let firstTime = true;

    const spideringRequiredState: MSC3575List['required_state'] = [
      [EventType.RoomJoinRules, ''],
      [EventType.RoomAvatar, ''],
      [EventType.RoomTombstone, ''],
      [EventType.RoomEncryption, ''],
      [EventType.RoomCreate, ''],
      [EventType.RoomTopic, ''],
      [EventType.RoomCanonicalAlias, ''],
      [EventType.RoomMember, MSC3575_STATE_KEY_ME],
      ['m.space.child', MSC3575_WILDCARD],
      ['im.ponies.room_emotes', MSC3575_WILDCARD],
    ];

    while (hasMore) {
      if (this.disposed) return;
      const ranges: [number, number][] = [[0, endIndex]];
      try {
        if (firstTime) {
          // Full setList on first call to register the list with all params.
          this.slidingSync.setList(LIST_SEARCH, {
            ranges,
            sort: ['by_recency'],
            timeline_limit: 0,
            required_state: spideringRequiredState,
          });
        } else {
          // Cheaper range-only update for subsequent pages; sticky params are preserved.
          this.slidingSync.setListRanges(LIST_SEARCH, ranges);
        }
      } catch {
        // Swallow errors — the next iteration will retry with updated ranges.
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((res) => {
          setTimeout(res, gapBetweenRequestsMs);
        });
      }

      if (this.disposed) return;
      const listData = this.slidingSync.getListData(LIST_SEARCH);
      hasMore = endIndex + 1 < (listData?.joinedCount ?? 0);
      endIndex += batchSize;
      firstTime = false;
    }
    log.info(`Spidering complete for ${this.mx.getUserId()}`);
  }

  /**
   * Enable or disable server-side room name filtering.
   * When `query` is a non-empty string, registers (or updates) a dedicated
   * `room_search` list that uses the MSC4186 `room_name_like` filter so the
   * server returns only rooms whose name matches the query. When `query` is
   * null or empty the list is reset to an unfiltered minimal range.
   */
  public setRoomNameSearch(query: string | null): void {
    if (this.disposed) return;
    const trimmed = query?.trim() ?? '';
    const filters: MSC3575List['filters'] = trimmed ? { room_name_like: trimmed } : {};
    this.ensureListRegistered(LIST_ROOM_SEARCH, {
      filters,
      ranges: [[0, 19]],
      sort: LIST_SORT_ORDER,
    });
  }

  /**
   * Activate or clear a space-scoped room list.
   * When `spaceId` is provided, registers (or updates) a dedicated `space`
   * list filtered to rooms that are children of that space.
   * Pass `null` to deactivate the space list (collapses range to 0–0).
   */
  public setSpaceScope(spaceId: string | null): void {
    if (this.disposed) return;
    const filters: MSC3575List['filters'] = spaceId
      ? { is_invite: false, spaces: [spaceId] }
      : { is_invite: false };
    this.ensureListRegistered(LIST_SPACE, {
      filters,
      ranges: spaceId ? [[0, Math.min(this.listPageSize - 1, 499)]] : [[0, 0]],
      sort: LIST_SORT_ORDER,
    });
  }

  /**
   * Subscribe to a room with the appropriate active-room subscription.
   * Encrypted rooms use the default subscription ([*,*]); unencrypted rooms use a
   * custom subscription that also requests lazy members.
   * Safe to call when already subscribed — the SDK deduplicates.
   * This is a no-op after dispose().
   */
  public subscribeToRoom(roomId: string): void {
    if (this.disposed) return;
    const room = this.mx.getRoom(roomId);
    const isEncrypted = this.mx.isRoomEncrypted(roomId);
    if (room && !isEncrypted) {
      this.slidingSync.useCustomSubscription(roomId, UNENCRYPTED_SUBSCRIPTION_KEY);
    }
    this.activeRoomSubscriptions.add(roomId);
    this.slidingSync.modifyRoomSubscriptions(new Set(this.activeRoomSubscriptions));
    log.info(`Active room subscription added: ${roomId}`);

    // One-shot listener: detect when first room data arrives.
    // Clean up any stale listener for the same roomId first.
    const existingListener = this.pendingRoomDataListeners.get(roomId);
    if (existingListener) {
      (this.slidingSync as any).removeListener(SlidingSyncEvent.RoomData, existingListener);
    }
    const onFirstRoomData = (dataRoomId: string) => {
      if (dataRoomId !== roomId) return;
      (this.slidingSync as any).removeListener(SlidingSyncEvent.RoomData, onFirstRoomData);
      this.pendingRoomDataListeners.delete(roomId);
    };
    this.pendingRoomDataListeners.set(roomId, onFirstRoomData);
    (this.slidingSync as any).on(SlidingSyncEvent.RoomData, onFirstRoomData);
  }

  /**
   * Remove the explicit room subscription for a room.
   * Rooms that are still in a list will continue to receive background updates.
   * This is a no-op after dispose().
   */
  public unsubscribeFromRoom(roomId: string): void {
    if (this.disposed) return;
    // Clean up any pending first-data listener for this room.
    const pendingListener = this.pendingRoomDataListeners.get(roomId);
    if (pendingListener) {
      (this.slidingSync as any).removeListener(SlidingSyncEvent.RoomData, pendingListener);
      this.pendingRoomDataListeners.delete(roomId);
    }
    this.activeRoomSubscriptions.delete(roomId);
    this.slidingSync.modifyRoomSubscriptions(new Set(this.activeRoomSubscriptions));
    log.info(`Active room subscription removed: ${roomId}`);
  }

  public static async probe(
    mx: MatrixClient,
    proxyBaseUrl: string,
    probeTimeoutMs: number
  ): Promise<boolean> {
    try {
      const response = await mx.slidingSync(
        {
          lists: {
            probe: {
              ranges: [[0, 0]],
              timeline_limit: 1,
              required_state: [],
            },
          },
          timeout: 0,
          clientTimeout: probeTimeoutMs,
        },
        proxyBaseUrl
      );

      return typeof response.pos === 'string' && response.pos.length > 0;
    } catch {
      return false;
    }
  }
}

import {
  ClientEvent,
  EventEmitterEvents,
  EventStatus,
  EventTimeline,
  EventTimelineSet,
  EventType,
  IRoomEvent,
  IStateEvent,
  KnownMembership,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomEvent,
  RoomMemberEvent,
  UNSTABLE_ELEMENT_FUNCTIONAL_USERS,
} from 'matrix-js-sdk';
import {
  MSC3575_STATE_KEY_LAZY,
  MSC3575_STATE_KEY_ME,
  MSC3575_WILDCARD,
  MSC3575List,
  MSC3575RoomData,
  MSC3575RoomSubscription,
  MSC3575SlidingSyncResponse,
  SlidingSync,
  SlidingSyncEvent,
  SlidingSyncState,
} from 'matrix-js-sdk/lib/sliding-sync';
import { StateEvent } from '../types/matrix/room';
import { markPreprocessingSlidingSyncTimelineReset } from './slidingSyncTimelineReset';
import { SlidingSyncSidebarCache } from './slidingSyncSidebarCache';

const LIST_JOINED = 'joined';
const LIST_INVITES = 'invites';
const LIST_TIMELINE_LIMIT = 1;

// MSC4186 room_subscriptions maximum.
const MAX_ROOM_SUBSCRIPTIONS = 100;

const LIST_PAGE_SIZE = 30;
const DEFAULT_POLL_TIMEOUT_MS = 45000;
// Mirrors the js-sdk's own BUFFER_PERIOD_MS so our watchdog sits after its `clientTimeout`.
const SDK_CLIENT_TIMEOUT_BUFFER_MS = 10_000;
const POLL_DEADLINE_MARGIN_MS = 20_000;

const ACTIVE_ROOM_SUBSCRIPTION_KEY = 'active_room';
const CALL_ROOM_SUBSCRIPTION_KEY = 'call_room';
const SIDEBAR_ROOM_SUBSCRIPTION_KEY = 'sidebar_room';
const SPACE_SUBSCRIPTION_KEY = 'space';
const IMAGE_PACK_SUBSCRIPTION_KEY = 'image_packs';
const SPACE_IMAGE_PACK_SUBSCRIPTION_KEY = 'space_image_packs';
const ACTIVE_ROOM_TIMELINE_LIMIT = 50;
const OPTIMISTIC_JOIN_MAX_SYNC_CYCLES = 10;
const OPTIMISTIC_JOIN_VERIFY_AFTER_CYCLES = 3;

type OptimisticJoin = {
  joinedAtSyncCount: number;
  lastSeenSyncCount: number;
  verificationRequested: boolean;
};

export type HydrationProgress = { loadedRooms: number; totalRooms: number };

type RoomScopedExtensionResponse = {
  rooms?: Record<string, unknown>;
};

type SlidingSyncOptions = {
  timelineLimit?: number;
  pollTimeoutMs?: number;
  initialRoomIds?: Iterable<string>;
};

const clampPositive = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return fallback;
  return Math.round(value);
};

type SlidingSyncEventLike = IStateEvent | IRoomEvent;

const isSelfMemberEvent = (event: SlidingSyncEventLike, userId: string): boolean =>
  event.type === EventType.RoomMember && 'state_key' in event && event.state_key === userId;

// Scans backwards so the newest wins in a timeline that still holds the
// previous membership.
const findSelfMemberEvent = <T extends SlidingSyncEventLike>(
  events: readonly T[],
  userId: string
): T | undefined => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event && isSelfMemberEvent(event, userId)) return event;
  }
  return undefined;
};

const membershipOf = (event: SlidingSyncEventLike | undefined): string | undefined => {
  const content = event?.content;
  return content && typeof content === 'object'
    ? ((content as { membership?: unknown }).membership as string | undefined)
    : undefined;
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

// "~" is the SDK's local-echo event id prefix (see MatrixClient.sendEvent).
const buildSelfJoinEvent = (
  roomId: string,
  userId: string,
  previousContent: unknown
): IStateEvent & { room_id: string } => {
  // Only the profile carries over; is_direct and third_party_invite are invite-only.
  const previous = (previousContent ?? {}) as { displayname?: unknown; avatar_url?: unknown };

  return {
    type: EventType.RoomMember,
    state_key: userId,
    room_id: roomId,
    sender: userId,
    event_id: `~cinny-self-join:${roomId}`,
    origin_server_ts: Date.now(),
    content: {
      membership: KnownMembership.Join,
      displayname: asString(previous.displayname),
      avatar_url: asString(previous.avatar_url),
    },
  };
};

const buildListRequiredState = (): MSC3575RoomSubscription['required_state'] => [
  [EventType.RoomAvatar, ''],
  [EventType.RoomTombstone, ''],
  [EventType.RoomEncryption, ''],
  [EventType.RoomCreate, ''],
  [EventType.RoomName, ''],
  [EventType.RoomCanonicalAlias, ''],
  [EventType.RoomJoinRules, ''],
  [EventType.RoomMember, MSC3575_STATE_KEY_ME],
  [StateEvent.GroupCallPrefix, ''],
  [StateEvent.GroupCallMemberPrefix, MSC3575_WILDCARD],
  // Feeds functional-member filtering for bridged DM names/avatars.
  [UNSTABLE_ELEMENT_FUNCTIONAL_USERS.name, ''],
];

const SPACE_REQUIRED_STATE: MSC3575RoomSubscription['required_state'] = [
  [EventType.RoomCreate, ''],
  [EventType.RoomName, ''],
  [EventType.RoomAvatar, ''],
  [EventType.RoomCanonicalAlias, ''],
  [EventType.RoomJoinRules, ''],
  [EventType.RoomEncryption, ''],
  [EventType.RoomTombstone, ''],
  [StateEvent.RoomBanner, ''],
  [EventType.SpaceChild, MSC3575_WILDCARD],
  [EventType.SpaceParent, MSC3575_WILDCARD],
];

const ACTIVE_ROOM_REQUIRED_STATE: MSC3575RoomSubscription['required_state'] = [
  // active room subscription includes all room data
  ...Object.values(StateEvent)
    .filter((type) => type !== StateEvent.RoomMember)
    .map((type): [string, string] => [type, MSC3575_WILDCARD]),
  [EventType.RoomMember, MSC3575_STATE_KEY_ME],
  [EventType.RoomMember, MSC3575_STATE_KEY_LAZY],
  ['im.vector.modular.widgets', MSC3575_WILDCARD],
  [UNSTABLE_ELEMENT_FUNCTIONAL_USERS.name, ''],
];

const buildActiveRoomSubscription = (timelineLimit: number): MSC3575RoomSubscription => ({
  timeline_limit: timelineLimit,
  required_state: ACTIVE_ROOM_REQUIRED_STATE,
});

const buildSpaceSubscription = (): MSC3575RoomSubscription => ({
  timeline_limit: 0,
  required_state: SPACE_REQUIRED_STATE,
});

const IMAGE_PACK_REQUIRED_STATE: MSC3575RoomSubscription['required_state'] = [
  [StateEvent.PoniesRoomEmotes, MSC3575_WILDCARD],
];

const buildImagePackSubscription = (): MSC3575RoomSubscription => ({
  timeline_limit: 0,
  required_state: IMAGE_PACK_REQUIRED_STATE,
});

// Pack rooms that are also spaces need both state sets; room subscriptions
// use exactly one named key, so register the union as its own subscription.
const buildSpaceImagePackSubscription = (): MSC3575RoomSubscription => ({
  timeline_limit: 0,
  required_state: [...SPACE_REQUIRED_STATE, ...IMAGE_PACK_REQUIRED_STATE],
});

const buildSidebarRoomSubscription = (): MSC3575RoomSubscription => ({
  timeline_limit: LIST_TIMELINE_LIMIT,
  required_state: buildListRequiredState(),
});

const buildCallRoomSubscription = (timelineLimit: number): MSC3575RoomSubscription => ({
  timeline_limit: timelineLimit,
  // MatrixRTC ignores memberships for users that are absent from the room
  // roster. Unlike a timeline, calls need every membership continuously.
  required_state: [...ACTIVE_ROOM_REQUIRED_STATE, [EventType.RoomMember, MSC3575_WILDCARD]],
});

const buildLists = (): Map<string, MSC3575List> => {
  const lists = new Map<string, MSC3575List>();
  const listRequiredState = buildListRequiredState();

  lists.set(LIST_JOINED, {
    ranges: [[0, LIST_PAGE_SIZE - 1]],
    timeline_limit: LIST_TIMELINE_LIMIT,
    required_state: listRequiredState,
    filters: { is_invite: false },
  });

  lists.set(LIST_INVITES, {
    ranges: [[0, LIST_PAGE_SIZE - 1]],
    timeline_limit: LIST_TIMELINE_LIMIT,
    required_state: listRequiredState,
    filters: { is_invite: true },
  });

  return lists;
};

const getListEndIndex = (list: MSC3575List | null): number => {
  if (!list?.ranges?.length) return -1;
  return list.ranges.reduce((max, range) => Math.max(max, range[1] ?? -1), -1);
};

type RoomScopedExtension = {
  enabled?: boolean;
  lists?: string[];
  rooms?: string[];
};

// Receipts stay unscoped on purpose: they drive unread state for every room in
// the sidebar, and a room that never receives one reads as permanently unread.
export const scopeTypingExtension = (
  extensions: object | undefined,
  roomIds: readonly string[]
): void => {
  if (!extensions) return;

  const { typing } = extensions as Record<string, unknown>;
  if (!typing || typeof typing !== 'object') return;

  const scopedTyping = typing as RoomScopedExtension;
  scopedTyping.lists = [];
  scopedTyping.rooms = [...roomIds];
};

type SlidingSyncTimelineRoomData = MSC3575RoomData & {
  expanded_timeline?: boolean;
  unstable_expanded_timeline?: boolean;
};

type TimelineResetCompletion = () => void;

/**
 * Adjusts a sliding sync response before the SDK processes it, so the room
 * timelines line up with the events we already hold. Returns a completion to
 * run once the SDK has processed the response, or null if no timeline was reset.
 */
export const prepareSlidingSyncTimelines = (
  resp: MSC3575SlidingSyncResponse | null,
  mx?: MatrixClient,
  subscribedRoomIds?: ReadonlySet<string>
): TimelineResetCompletion | null => {
  if (!resp?.rooms) return null;
  const resetTimelines: Array<{ room: Room; timelineSet: EventTimelineSet }> = [];
  const pendingEventsToRestore: Array<{
    timelineSet: EventTimelineSet;
    events: MatrixEvent[];
  }> = [];

  Object.entries(resp.rooms).forEach(([roomId, roomData]) => {
    // The SDK reads these fields after we return, so they are corrected in place.
    const timelineData = roomData as SlidingSyncTimelineRoomData;
    const serverReportedLimited = timelineData.limited === true;
    const hasExpandedFlag =
      timelineData.expanded_timeline === true || timelineData.unstable_expanded_timeline === true;
    const numLive = timelineData.num_live;
    const timeline = Array.isArray(timelineData.timeline) ? timelineData.timeline : [];
    const timelineLength = timeline.length;
    const room = mx?.getRoom(roomId);
    const timelineSet = room?.getUnfilteredTimelineSet();
    const liveTimeline = room?.getLiveTimeline();
    const liveEvents = liveTimeline?.getEvents() ?? [];
    if (serverReportedLimited && room) {
      room.clearLoadedMembersIfNeeded().catch((error: unknown) => {
        console.warn('Sliding sync: failed to flush lazily loaded members after a gap', error);
      });
    }
    const liveEventIds: string[] = [];
    liveEvents.forEach((event) => {
      const eventId = event.getId();
      if (eventId) liveEventIds.push(eventId);
    });
    const knownEventIds = new Set(liveEventIds);
    const hasHistoricalEvents =
      timelineData.initial !== true &&
      typeof numLive === 'number' &&
      Number.isInteger(numLive) &&
      numLive >= 0 &&
      numLive < timelineLength;
    let hasHistoricalOverlap = false;
    if (!hasExpandedFlag && !hasHistoricalEvents && timelineData.initial !== true) {
      let sawUnknownEvent = false;
      hasHistoricalOverlap = timeline.some((event) => {
        const eventId = event.event_id;
        if (typeof eventId !== 'string') return false;
        if (knownEventIds.has(eventId)) return sawUnknownEvent;
        sawUnknownEvent = true;
        return false;
      });
    }

    const responseEventIds = timeline
      .map((event) => event.event_id)
      .filter((eventId): eventId is string => typeof eventId === 'string');
    const firstKnownResponseIndex = responseEventIds.findIndex((eventId) =>
      knownEventIds.has(eventId)
    );
    const firstKnownLiveIndex =
      firstKnownResponseIndex < 0
        ? -1
        : liveEventIds.indexOf(responseEventIds[firstKnownResponseIndex]);
    const hasSparseOverlap = firstKnownResponseIndex > 0 && firstKnownLiveIndex > 0;

    const isRequestedExpansion =
      subscribedRoomIds?.has(roomId) === true &&
      knownEventIds.size > 0 &&
      firstKnownResponseIndex < 0;

    const shouldMarkLimited =
      timelineLength > 0 &&
      (hasExpandedFlag || hasHistoricalEvents || hasHistoricalOverlap || isRequestedExpansion);

    if (shouldMarkLimited) timelineData.limited = true;

    const isGapped = firstKnownResponseIndex < 0 || hasSparseOverlap;
    if (
      knownEventIds.size > 0 &&
      room &&
      timelineSet &&
      isGapped &&
      responseEventIds.length > 0 &&
      typeof timelineData.prev_batch === 'string' &&
      (timelineData.initial === true || timelineData.limited === true)
    ) {
      const pendingEvents = liveEvents.filter((event) => event.isSending());
      if (pendingEvents.length > 0) {
        pendingEventsToRestore.push({ timelineSet, events: pendingEvents });
      }
      const previousOldState = room.oldState;
      markPreprocessingSlidingSyncTimelineReset(timelineSet, () => {
        timelineSet.resetLiveTimeline(
          typeof timelineData.prev_batch === 'string' ? timelineData.prev_batch : undefined
        );
      });
      const newLiveTimeline = timelineSet.getLiveTimeline();
      const newOldState = newLiveTimeline.getState(EventTimeline.BACKWARDS);
      const newCurrentState = newLiveTimeline.getState(EventTimeline.FORWARDS);
      if (newOldState) room.oldState = newOldState;
      if (newCurrentState) room.currentState = newCurrentState;
      if (room.oldState !== previousOldState) {
        room.emit(RoomEvent.OldStateUpdated, room, previousOldState, room.oldState);
      }
      resetTimelines.push({ room, timelineSet });
      return;
    }

    // The SDK writes prev_batch over the live timeline's BACKWARDS token on every
    // limited response. When the window starts at an event we already have below
    // our top, nothing is prepended and the top does not move, so that token would
    // back-paginate from the wrong stream position and prepend newer events.
    if (timelineData.limited === true && firstKnownResponseIndex === 0 && firstKnownLiveIndex > 0) {
      const topToken = liveTimeline?.getPaginationToken(EventTimeline.BACKWARDS);
      if (typeof topToken === 'string') timelineData.prev_batch = topToken;
    }

    if (!shouldMarkLimited) return;

    if (typeof timelineData.prev_batch !== 'string') {
      const token = liveTimeline?.getPaginationToken(EventTimeline.BACKWARDS);
      if (typeof token === 'string') timelineData.prev_batch = token;
    }
  });

  if (resetTimelines.length === 0) return null;
  mx?.resetNotifTimelineSet();

  return () => {
    pendingEventsToRestore.forEach(({ timelineSet, events }) => {
      const liveTimeline = timelineSet.getLiveTimeline();
      events.forEach((event) => {
        const eventId = event.getId();
        if (
          event.status === null ||
          event.status === EventStatus.CANCELLED ||
          !eventId ||
          timelineSet.findEventById(eventId)
        ) {
          return;
        }
        timelineSet.addEventToTimeline(event, liveTimeline, {
          toStartOfTimeline: false,
          addToState: false,
        });
      });
    });

    resetTimelines.forEach(({ room, timelineSet }) => {
      room.emit(RoomEvent.TimelineRefresh, room, timelineSet);
    });
  };
};

export class SlidingSyncManager {
  private disposed = false;

  private readonly listKeys: string[];

  private readonly activeRoomSubscriptions = new Set<string>();

  private readonly callRoomSubscriptions = new Set<string>();

  /**
   * Rooms joined locally via reconcileRoomMembership(Join) but not yet confirmed
   * joined by a sliding sync response. The SDK reverts these to "invite" when the
   * server still sends invite_state after a join, so we re-assert join each sync.
   */
  private readonly optimisticallyJoinedRoomIds = new Map<string, OptimisticJoin>();

  private readonly sidebarRoomSubscriptions = new Set<string>();

  private readonly spaceSubscriptions = new Set<string>();

  private deferredSpaceSubscriptions = new Set<string>();

  private readonly imagePackRoomSubscriptions = new Set<string>();

  private deferredImagePackSubscriptions: Set<string> | null = null;

  private roomSubscriptionSyncQueued = false;

  private readonly roomTimelineLimit: number;

  private readonly sidebarCache: SlidingSyncSidebarCache;

  private cacheHydrationPromise: Promise<boolean> = Promise.resolve(false);

  private cacheHydrationNewListener:
    | ((eventName: string | symbol, listener: (...args: unknown[]) => void) => void)
    | undefined;

  private cacheHydrationResolve: ((hydrated: boolean) => void) | undefined;

  private hydratingSidebarCache = false;

  private readonly onCacheRoomData: (roomId: string, data: MSC3575RoomData) => void;

  private readonly onCacheAccountData: (event: MatrixEvent) => void;

  private readonly onLifecycle: (
    state: SlidingSyncState,
    resp: MSC3575SlidingSyncResponse | null,
    err?: Error
  ) => void;

  private readonly onMembershipLeave: (
    event: unknown,
    member: { userId: string; roomId: string; membership?: string }
  ) => void;

  private listsFullyLoaded = false;

  private initialListHydrationCompleted = false;

  private sidebarCacheReconciled = false;

  private sidebarCacheReconciliationQueued = false;

  private readonly serverMembershipRoomIds = new Set<string>();

  private syncCount = 0;

  /**
   * Room IDs that received data in the current sync cycle. Used to narrow the
   * sync-settled unread recompute to only changed rooms instead of all rooms.
   * Populated by onCacheRoomData, cleared after the settled listeners fire.
   */
  private readonly dirtyRoomIds = new Set<string>();

  private readonly responseSettledListeners = new Set<
    (dirtyRoomIds: ReadonlySet<string>) => void
  >();

  /**
   * One-shot RoomData listeners keyed by roomId, waiting for the first data of a
   * room subscription. Cleaned up after the first fire or on unsubscribe/dispose.
   */
  private readonly pendingRoomDataListeners = new Map<
    string,
    (roomId: string, data: MSC3575RoomData) => void
  >();

  private readonly roomSubscriptionStatusListeners = new Map<
    string,
    Set<(loading: boolean) => void>
  >();

  private readonly roomDataAwaitingSyncCompletion = new Set<string>();

  private readonly hydrationStatusListeners = new Set<
    (isHydrating: boolean, progress?: HydrationProgress) => void
  >();

  /**
   * Sync cycle each room subscription was requested in. A quiet room can be
   * subscribed to without the server ever sending a RoomData envelope for it,
   * so the loading flag needs a deadline of its own rather than waiting on
   * pendingRoomDataListeners, which would never fire.
   */
  private readonly roomSubscriptionLoadingSince = new Map<string, number>();

  private initialSyncCompleted = false;

  private readonly timelineResetCompletions = new WeakMap<
    MSC3575SlidingSyncResponse,
    TimelineResetCompletion
  >();

  private readonly requestedListRangeEnds = new Map<string, number>();

  private readonly confirmedListRangeEnds = new Map<string, number>();

  private readonly pollDeadlineMs: number;

  private pollWatchdogTimer: ReturnType<typeof setTimeout> | undefined;

  public readonly slidingSync: SlidingSync;

  public constructor(
    private readonly mx: MatrixClient,
    baseUrl: string,
    options: SlidingSyncOptions = {}
  ) {
    const pollTimeoutMs = clampPositive(options.pollTimeoutMs, DEFAULT_POLL_TIMEOUT_MS);
    this.pollDeadlineMs = pollTimeoutMs + SDK_CLIENT_TIMEOUT_BUFFER_MS + POLL_DEADLINE_MARGIN_MS;

    const roomTimelineLimit = clampPositive(options.timelineLimit, ACTIVE_ROOM_TIMELINE_LIMIT);
    this.roomTimelineLimit = roomTimelineLimit;
    this.sidebarCache = new SlidingSyncSidebarCache(mx.getSafeUserId());

    const lists = buildLists();
    this.listKeys = Array.from(lists.keys());
    lists.forEach((list, key) => {
      this.requestedListRangeEnds.set(key, getListEndIndex(list));
    });
    this.slidingSync = new SlidingSync(
      baseUrl,
      lists,
      buildActiveRoomSubscription(roomTimelineLimit),
      mx,
      pollTimeoutMs
    );

    this.slidingSync.addCustomSubscription(
      ACTIVE_ROOM_SUBSCRIPTION_KEY,
      buildActiveRoomSubscription(roomTimelineLimit)
    );
    this.slidingSync.addCustomSubscription(
      CALL_ROOM_SUBSCRIPTION_KEY,
      buildCallRoomSubscription(roomTimelineLimit)
    );
    this.slidingSync.addCustomSubscription(
      SIDEBAR_ROOM_SUBSCRIPTION_KEY,
      buildSidebarRoomSubscription()
    );
    this.slidingSync.addCustomSubscription(
      IMAGE_PACK_SUBSCRIPTION_KEY,
      buildImagePackSubscription()
    );
    this.slidingSync.addCustomSubscription(SPACE_SUBSCRIPTION_KEY, buildSpaceSubscription());
    this.slidingSync.addCustomSubscription(
      SPACE_IMAGE_PACK_SUBSCRIPTION_KEY,
      buildSpaceImagePackSubscription()
    );

    this.onLifecycle = (state, resp, err) => {
      if (err) {
        console.warn('Sliding sync error', err);
      }

      if (this.disposed) return;

      this.armPollWatchdog();

      if (err || !resp || state !== SlidingSyncState.Complete) return;

      this.timelineResetCompletions.get(resp)?.();
      this.timelineResetCompletions.delete(resp);
      this.recordServerMembershipRooms(resp);
      this.reassertOptimisticJoins();

      this.roomDataAwaitingSyncCompletion.forEach((roomId) =>
        this.notifyRoomSubscriptionStatus(roomId, false)
      );
      this.roomDataAwaitingSyncCompletion.clear();

      this.syncCount += 1;

      // A subscription that saw no room data is settled once a full cycle has
      // completed after the one it was requested in: the server had nothing to
      // send for it. The extra cycle is the grace period for the request that
      // actually carried the subscription.
      this.roomSubscriptionLoadingSince.forEach((since, roomId) => {
        if (this.syncCount < since + 2) return;
        this.roomSubscriptionLoadingSince.delete(roomId);
        this.notifyRoomSubscriptionStatus(roomId, false);
      });

      this.requestedListRangeEnds.forEach((rangeEnd, key) => {
        this.confirmedListRangeEnds.set(key, rangeEnd);
      });

      this.initialSyncCompleted = true;

      this.expandListsByPage();
      this.ensureListCoverage();

      ['receipts', 'account_data'].forEach((extensionName) => {
        const extension = resp.extensions?.[extensionName] as
          | RoomScopedExtensionResponse
          | undefined;
        const rooms = extension?.rooms ?? {};
        Object.entries(rooms).forEach(([roomId, data]) => {
          if (extensionName === 'account_data' && Array.isArray(data) && data.length === 0) return;
          this.dirtyRoomIds.add(roomId);
        });
      });

      // Listeners run once the SDK has applied the whole response.
      queueMicrotask(() => {
        if (this.disposed) return;
        const dirtyRoomIds = new Set(this.dirtyRoomIds);
        this.dirtyRoomIds.clear();
        this.responseSettledListeners.forEach((listener) => listener(dirtyRoomIds));
      });
    };

    this.onMembershipLeave = (_event, member) => {
      if (member.userId !== this.mx.getUserId()) return;
      if (member.membership !== KnownMembership.Leave && member.membership !== KnownMembership.Ban)
        return;
      this.handleRoomLeaveSubscriptions(member.roomId);
    };

    this.onCacheRoomData = (roomId, data) => {
      this.dirtyRoomIds.add(roomId);
      this.sidebarCache.cacheRoom(roomId, data);

      if (!this.initialListHydrationCompleted || this.hydratingSidebarCache) return;

      // A room that shows up in the lists after they were loaded (a new join, an
      // invite) gets one round of list state through a room subscription.
      let subscriptionsChanged = false;
      const completedSidebarHydration = this.sidebarRoomSubscriptions.delete(roomId);
      if (completedSidebarHydration) subscriptionsChanged = true;

      if (
        data.initial === true &&
        !completedSidebarHydration &&
        !this.activeRoomSubscriptions.has(roomId)
      ) {
        this.sidebarRoomSubscriptions.add(roomId);
        subscriptionsChanged = true;
      }

      if (subscriptionsChanged) this.queueRoomSubscriptionSync();
    };
    this.onCacheAccountData = (event) => this.sidebarCache.cacheAccountData(event);

    Array.from(options.initialRoomIds ?? []).forEach((roomId) => this.subscribeToRoom(roomId));
  }

  public attach(): void {
    this.slidingSync.on(SlidingSyncEvent.Lifecycle, this.onLifecycle);
    this.slidingSync.on(SlidingSyncEvent.RoomData, this.onCacheRoomData);
    this.mx.on(RoomMemberEvent.Membership, this.onMembershipLeave);
    this.mx.on(ClientEvent.AccountData, this.onCacheAccountData);

    this.armPollWatchdog();
  }

  /**
   * Backstop for the SDK's own `clientTimeout`, which is a JS timer and so cannot fire
   * while the browser has frozen the page. Re-arms itself because the SDK's abort path
   * `continue`s without emitting a lifecycle event.
   */
  private armPollWatchdog(): void {
    if (this.disposed) return;
    clearTimeout(this.pollWatchdogTimer);
    this.pollWatchdogTimer = setTimeout(() => {
      this.pollWatchdogTimer = undefined;
      if (this.disposed) return;
      console.warn('Sliding sync poll exceeded client-side deadline; cycling transport');
      this.slidingSync.resend();
      this.armPollWatchdog();
    }, this.pollDeadlineMs);
  }

  public dispose(): void {
    if (this.disposed) return;

    this.pendingRoomDataListeners.forEach((listener) =>
      this.slidingSync.removeListener(SlidingSyncEvent.RoomData, listener)
    );
    this.pendingRoomDataListeners.clear();
    this.roomSubscriptionLoadingSince.clear();
    this.roomDataAwaitingSyncCompletion.clear();
    this.roomSubscriptionStatusListeners.forEach((listeners) =>
      listeners.forEach((listener) => listener(false))
    );
    this.roomSubscriptionStatusListeners.clear();
    this.optimisticallyJoinedRoomIds.clear();
    this.dirtyRoomIds.clear();
    this.responseSettledListeners.clear();
    this.hydrationStatusListeners.forEach((listener) => listener(false));
    this.hydrationStatusListeners.clear();

    this.disposed = true;
    clearTimeout(this.pollWatchdogTimer);
    this.pollWatchdogTimer = undefined;
    this.slidingSync.stop();
    this.slidingSync.removeListener(SlidingSyncEvent.Lifecycle, this.onLifecycle);
    this.slidingSync.removeListener(SlidingSyncEvent.RoomData, this.onCacheRoomData);
    if (this.cacheHydrationNewListener) {
      this.slidingSync.removeListener(
        EventEmitterEvents.NewListener,
        this.cacheHydrationNewListener as never
      );
      this.cacheHydrationNewListener = undefined;
    }
    this.cacheHydrationResolve?.(false);
    this.cacheHydrationResolve = undefined;
    this.mx.removeListener(RoomMemberEvent.Membership, this.onMembershipLeave);
    this.mx.removeListener(ClientEvent.AccountData, this.onCacheAccountData);
    this.sidebarCache.dispose();
  }

  private recordServerMembershipRooms(response: MSC3575SlidingSyncResponse): void {
    const userId = this.mx.getSafeUserId();
    Object.entries(response.rooms ?? {}).forEach(([roomId, roomData]) => {
      const membership = membershipOf(
        findSelfMemberEvent(
          [...(roomData.required_state ?? []), ...(roomData.invite_state ?? [])],
          userId
        )
      );

      if (membership === KnownMembership.Leave || membership === KnownMembership.Ban) {
        this.serverMembershipRoomIds.delete(roomId);
      } else {
        this.serverMembershipRoomIds.add(roomId);
      }
    });
  }

  /**
   * Once the lists are loaded, drops cached rooms the server no longer reports
   * us in, such as rooms left from another client while this one was closed.
   */
  private reconcileSidebarCacheMembership(): void {
    if (this.sidebarCacheReconciled || this.sidebarCacheReconciliationQueued) return;
    this.sidebarCacheReconciliationQueued = true;

    this.cacheHydrationPromise
      .then(async () => {
        if (this.disposed || this.sidebarCacheReconciled) return;

        const { joined_rooms: joinedRoomIds } = await this.mx.getJoinedRooms();

        if (this.disposed || this.sidebarCacheReconciled) return;
        this.sidebarCacheReconciled = true;

        const validRoomIds = new Set([...this.serverMembershipRoomIds, ...joinedRoomIds]);

        this.sidebarCache.clearInviteStateForRooms(joinedRoomIds);

        joinedRoomIds.forEach((roomId) => {
          const room = this.mx.getRoom(roomId);
          if (room?.getMyMembership() === KnownMembership.Invite) {
            this.assertLocalJoin(room);
          }
        });

        const removedRoomIds = this.sidebarCache.reconcileRooms(validRoomIds);
        removedRoomIds.forEach((roomId) => {
          this.mx.getRoom(roomId)?.updateMyMembership(KnownMembership.Leave);
          this.unsubscribeFromRoom(roomId);
        });
      })
      .catch((error: unknown) => {
        console.warn('Skipped sliding sync sidebar cache reconciliation', error);
      });
  }

  /**
   * Replays the cached room list into the SDK as soon as it starts listening for
   * room data, so the sidebar renders before the first sliding sync response.
   */
  public prepareSidebarCacheHydration(): void {
    if (this.disposed || this.cacheHydrationNewListener) return;

    this.cacheHydrationPromise = new Promise<boolean>((resolve) => {
      this.cacheHydrationResolve = resolve;
    });

    this.cacheHydrationNewListener = (eventName) => {
      if (eventName !== SlidingSyncEvent.RoomData) return;
      const listener = this.cacheHydrationNewListener;
      if (listener) {
        this.slidingSync.removeListener(EventEmitterEvents.NewListener, listener as never);
      }
      this.cacheHydrationNewListener = undefined;

      queueMicrotask(() => {
        this.hydratingSidebarCache = true;
        this.sidebarCache
          .hydrate(this.mx, this.slidingSync)
          .then((hydrated) => this.cacheHydrationResolve?.(hydrated))
          .catch(() => this.cacheHydrationResolve?.(false))
          .finally(() => {
            this.hydratingSidebarCache = false;
            this.cacheHydrationResolve = undefined;
          });
      });
    };

    this.slidingSync.on(EventEmitterEvents.NewListener, this.cacheHydrationNewListener as never);
  }

  public waitForSidebarCacheHydration(): Promise<boolean> {
    return this.cacheHydrationPromise;
  }

  /**
   * Calls the listener after every processed sliding sync response with the rooms
   * it touched, including receipt and account data changes.
   */
  public subscribeToResponseSettled(
    listener: (dirtyRoomIds: ReadonlySet<string>) => void
  ): () => void {
    this.responseSettledListeners.add(listener);
    return () => this.responseSettledListeners.delete(listener);
  }

  public trackTimelineResetCompletion(
    response: MSC3575SlidingSyncResponse,
    completion: TimelineResetCompletion
  ): void {
    this.timelineResetCompletions.set(response, completion);
  }

  /**
   * Grows each list window by one page per sync cycle until the whole room list
   * is loaded, so the first response stays small and the sidebar fills in
   * progressively instead of waiting on a single huge response.
   */
  private expandListsByPage(): void {
    if (!this.initialSyncCompleted) return;
    if (this.initialListHydrationCompleted) return;

    let allListsComplete = true;
    let expandedAny = false;

    this.listKeys.forEach((key) => {
      const knownCount = this.slidingSync.getListData(key)?.joinedCount ?? 0;
      if (knownCount <= 0) return;

      const requestedEnd = getListEndIndex(this.slidingSync.getListParams(key));
      const currentEnd = this.confirmedListRangeEnds.get(key) ?? -1;
      const maxEnd = knownCount - 1;

      if (requestedEnd > currentEnd) {
        allListsComplete = false;
        return;
      }

      if (currentEnd >= maxEnd) return;

      allListsComplete = false;

      const desiredEnd = Math.min(maxEnd, currentEnd + LIST_PAGE_SIZE);
      if (desiredEnd === currentEnd) return;

      this.slidingSync.setListRanges(key, [[0, desiredEnd]]);
      this.requestedListRangeEnds.set(key, desiredEnd);
      expandedAny = true;
    });

    if (allListsComplete) {
      if (!this.listsFullyLoaded) {
        this.listsFullyLoaded = true;
        this.initialListHydrationCompleted = true;
        this.hydrationStatusListeners.forEach((listener) => listener(false));
        this.reconcileSidebarCacheMembership();
        setTimeout(() => this.flushDeferredSubscriptions(), 0);
      }
    } else if (expandedAny) {
      const progress = this.getHydrationProgress();
      this.hydrationStatusListeners.forEach((listener) => listener(true, progress));
    }
  }

  public getHydrationProgress(): HydrationProgress {
    let loadedRooms = 0;
    let totalRooms = 0;
    this.listKeys.forEach((key) => {
      const knownCount = this.slidingSync.getListData(key)?.joinedCount ?? 0;
      const currentEnd = this.confirmedListRangeEnds.get(key) ?? -1;

      if (knownCount > 0) {
        totalRooms += knownCount;
        loadedRooms += Math.min(knownCount, currentEnd + 1);
      }
    });
    return { loadedRooms, totalRooms };
  }

  /** Whether the room lists are still being paged in after startup. */
  public isSyncingRoomData(): boolean {
    return !this.listsFullyLoaded;
  }

  public onHydrationStatusChange(
    listener: (isHydrating: boolean, progress?: HydrationProgress) => void
  ): () => void {
    this.hydrationStatusListeners.add(listener);
    listener(
      this.isSyncingRoomData(),
      this.isSyncingRoomData() ? this.getHydrationProgress() : undefined
    );
    return () => {
      this.hydrationStatusListeners.delete(listener);
    };
  }

  // Paging stops once every list is covered, but the counts keep growing, and a state
  // change does not bump a room back into the window.
  private ensureListCoverage(): void {
    if (!this.initialListHydrationCompleted) return;

    this.listKeys.forEach((key) => {
      const knownCount = this.slidingSync.getListData(key)?.joinedCount ?? 0;
      const desiredEnd = knownCount - 1;
      if (desiredEnd <= getListEndIndex(this.slidingSync.getListParams(key))) return;

      this.slidingSync.setListRanges(key, [[0, desiredEnd]]);
      this.requestedListRangeEnds.set(key, desiredEnd);
    });
  }

  /**
   * Re-assert join for rooms the SDK reverted to "invite" because the server
   * still sent invite_state after a successful join. Runs after the SDK has
   * finished processing all room data for the cycle (Complete fires
   * post-processing), so the app sees the corrected membership.
   *
   * Release is driven by sanitizeOptimisticJoinResponse, not by the SDK
   * membership read back here: that would release the room merely because
   * nothing in the cycle touched it, letting a later stale invite win for good.
   */
  private reassertOptimisticJoins(): void {
    this.optimisticallyJoinedRoomIds.forEach((tracked, roomId) => {
      const room = this.mx.getRoom(roomId);
      if (!room) {
        this.optimisticallyJoinedRoomIds.delete(roomId);
        return;
      }
      this.assertLocalJoin(room);

      if (
        !tracked.verificationRequested &&
        this.syncCount - tracked.joinedAtSyncCount >= OPTIMISTIC_JOIN_VERIFY_AFTER_CYCLES
      ) {
        // eslint-disable-next-line no-param-reassign
        tracked.verificationRequested = true;
        this.verifyOptimisticJoin(roomId);
      }

      if (this.syncCount - tracked.lastSeenSyncCount >= OPTIMISTIC_JOIN_MAX_SYNC_CYCLES) {
        this.optimisticallyJoinedRoomIds.delete(roomId);
      }
    });
  }

  /**
   * Asks the authoritative /joined_rooms who is right when the disagreement
   * lasts. A "no" means our /join is stale (a fresh invite after a kick, or a
   * join that never committed), so stop overriding the server. Errors keep the
   * optimistic join: an unreachable server must not strand the user on an invite.
   */
  private verifyOptimisticJoin(roomId: string): void {
    this.mx
      .getJoinedRooms()
      .then((response) => {
        if (this.disposed || !this.optimisticallyJoinedRoomIds.has(roomId)) return;
        if (response.joined_rooms.includes(roomId)) return;

        this.optimisticallyJoinedRoomIds.delete(roomId);
      })
      .catch((error: unknown) => {
        console.warn('Could not verify optimistic sliding sync join; still assuming joined', error);
      });
  }

  /**
   * Room.recalculate() derives selfMembership from the m.room.member event, so
   * fixing only one of the two lets the next recalculate() undo it. The crypto
   * layer reads membership from that event too.
   */
  private assertLocalJoin(room: Room): void {
    if (room.getMyMembership() !== KnownMembership.Join) {
      room.updateMyMembership(KnownMembership.Join);
    }
    this.repairSelfJoinMemberEvent(room);
  }

  private repairSelfJoinMemberEvent(room: Room): void {
    const myUserId = this.mx.getUserId();
    if (!myUserId) return;
    const roomState = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
    if (!roomState) return;
    const existing = roomState.getStateEvents(EventType.RoomMember, myUserId)?.getContent();
    if (existing?.membership === KnownMembership.Join) return;

    roomState.setStateEvents([
      new MatrixEvent(buildSelfJoinEvent(room.roomId, myUserId, existing)),
    ]);
  }

  /**
   * Strips the stale stripped invite some servers keep sending for a room we
   * already joined, before the SDK derives an invite from it.
   *
   * Which field reports the membership varies: Synapse omits required_state for
   * invites, and Continuwuity does not substitute the "$ME" state key at all, so
   * our own member event never appears in its required_state.
   */
  public sanitizeOptimisticJoinResponse(resp: MSC3575SlidingSyncResponse | null): void {
    if (!resp?.rooms || this.optimisticallyJoinedRoomIds.size === 0) return;
    const myUserId = this.mx.getUserId();
    if (!myUserId) return;
    const { rooms } = resp;

    this.optimisticallyJoinedRoomIds.forEach((tracked, roomId) => {
      // The SDK reads the room data after we return, so it is corrected in place.
      const roomData = rooms[roomId];
      if (!roomData) return;

      // eslint-disable-next-line no-param-reassign
      tracked.lastSeenSyncCount = this.syncCount;

      const stateMember = findSelfMemberEvent(roomData.required_state ?? [], myUserId);
      const reported =
        membershipOf(stateMember) ??
        membershipOf(findSelfMemberEvent(roomData.timeline ?? [], myUserId));
      const staleInvite = findSelfMemberEvent(roomData.invite_state ?? [], myUserId);

      if (
        reported !== undefined &&
        reported !== KnownMembership.Invite &&
        reported !== KnownMembership.Knock
      ) {
        // Our join, or something newer we must not suppress.
        this.optimisticallyJoinedRoomIds.delete(roomId);
        // The SDK ignores required_state whenever invite_state is present.
        if (reported === KnownMembership.Join) delete roomData.invite_state;
        return;
      }

      if (!roomData.invite_state) {
        // The server stopped treating us as invited.
        this.optimisticallyJoinedRoomIds.delete(roomId);
        return;
      }

      // Replaced, not removed: the sidebar cache only clears its persisted
      // invite once required_state says join.
      delete roomData.invite_state;
      roomData.required_state = [
        ...(roomData.required_state ?? []).filter((event) => !isSelfMemberEvent(event, myUserId)),
        buildSelfJoinEvent(roomId, myUserId, staleInvite?.content ?? stateMember?.content),
      ];
    });
  }

  /** Applies a join or leave the user just made locally, ahead of sliding sync. */
  public reconcileRoomMembership(
    roomId: string,
    membership: KnownMembership.Join | KnownMembership.Leave
  ): void {
    const room = this.mx.getRoom(roomId);
    room?.updateMyMembership(membership);

    if (membership === KnownMembership.Join) {
      if (room) this.repairSelfJoinMemberEvent(room);
      // The cache clears its own invite only once required_state says join, which
      // a server without "$ME" substitution never sends, so drop it here.
      this.sidebarCache.clearInviteStateForRooms([roomId]);
      // Track the room so we can re-assert join if the SDK reverts it while the
      // server still reports the room in the invite list.
      this.optimisticallyJoinedRoomIds.set(roomId, {
        joinedAtSyncCount: this.syncCount,
        lastSeenSyncCount: this.syncCount,
        verificationRequested: false,
      });
      // Subscribe so the next sync pulls real joined member state into the
      // room's current state, letting recalculate() see "join" not "invite".
      this.subscribeToRoom(roomId);
      return;
    }

    this.optimisticallyJoinedRoomIds.delete(roomId);
    this.handleRoomLeaveSubscriptions(roomId);
    this.mx.store.removeRoom(roomId);
  }

  private handleRoomLeaveSubscriptions(roomId: string): void {
    this.sidebarCache.removeRoom(roomId);
    const removedPassiveSubscription = this.removePassiveSubscriptions(roomId);
    if (this.activeRoomSubscriptions.has(roomId)) {
      this.unsubscribeFromRoom(roomId);
    } else if (removedPassiveSubscription) {
      this.queueRoomSubscriptionSync();
    }
  }

  // Includes the deferred sets so a later flush cannot resubscribe a room we left.
  private removePassiveSubscriptions(roomId: string): boolean {
    const removedSpace = this.spaceSubscriptions.delete(roomId);
    const removedSidebar = this.sidebarRoomSubscriptions.delete(roomId);
    const removedImagePack = this.imagePackRoomSubscriptions.delete(roomId);
    this.deferredSpaceSubscriptions.delete(roomId);
    this.deferredImagePackSubscriptions?.delete(roomId);
    return removedSpace || removedSidebar || removedImagePack;
  }

  private flushDeferredSubscriptions(): void {
    if (this.disposed || !this.listsFullyLoaded) return;

    const spaces = this.deferredSpaceSubscriptions;
    this.deferredSpaceSubscriptions = new Set();
    this.setSpaceSubscriptions(spaces);

    const imagePacks = this.deferredImagePackSubscriptions;
    this.deferredImagePackSubscriptions = null;
    if (imagePacks) this.setImagePackSubscriptions(imagePacks);
  }

  private queueRoomSubscriptionSync(): void {
    if (this.disposed || this.roomSubscriptionSyncQueued) return;
    this.roomSubscriptionSyncQueued = true;
    queueMicrotask(() => {
      this.roomSubscriptionSyncQueued = false;
      if (!this.disposed) this.syncRoomSubscriptions();
    });
  }

  private syncRoomSubscriptions(): void {
    // MSC4186 rejects a request carrying more than MAX_ROOM_SUBSCRIPTIONS with
    // M_INVALID_PARAM, so fill by priority and drop the rest.
    const desiredSubscriptions = new Set<string>();
    let dropped = 0;
    [
      this.callRoomSubscriptions,
      this.activeRoomSubscriptions,
      this.sidebarRoomSubscriptions,
      this.spaceSubscriptions,
      this.imagePackRoomSubscriptions,
    ].forEach((group) =>
      group.forEach((roomId) => {
        if (desiredSubscriptions.has(roomId)) return;
        if (desiredSubscriptions.size >= MAX_ROOM_SUBSCRIPTIONS) {
          dropped += 1;
          return;
        }
        desiredSubscriptions.add(roomId);
      })
    );
    if (dropped > 0) {
      console.warn(
        `Sliding sync dropped ${dropped} room subscriptions over the ${MAX_ROOM_SUBSCRIPTIONS} cap`
      );
    }

    desiredSubscriptions.forEach((roomId) => {
      if (this.callRoomSubscriptions.has(roomId)) {
        this.slidingSync.useCustomSubscription(roomId, CALL_ROOM_SUBSCRIPTION_KEY);
      } else if (this.activeRoomSubscriptions.has(roomId)) {
        this.slidingSync.useCustomSubscription(roomId, ACTIVE_ROOM_SUBSCRIPTION_KEY);
      } else if (this.spaceSubscriptions.has(roomId)) {
        this.slidingSync.useCustomSubscription(
          roomId,
          this.imagePackRoomSubscriptions.has(roomId)
            ? SPACE_IMAGE_PACK_SUBSCRIPTION_KEY
            : SPACE_SUBSCRIPTION_KEY
        );
      } else if (this.sidebarRoomSubscriptions.has(roomId)) {
        // Spaces need their child state even when their initial list data also
        // placed them in the lightweight sidebar subscription.
        this.slidingSync.useCustomSubscription(roomId, SIDEBAR_ROOM_SUBSCRIPTION_KEY);
      } else {
        this.slidingSync.useCustomSubscription(roomId, IMAGE_PACK_SUBSCRIPTION_KEY);
      }
    });

    this.slidingSync.modifyRoomSubscriptions(desiredSubscriptions);
  }

  // A newly opened room should not wait behind a list page that is still loading.
  private pauseUnconfirmedListExpansion(): void {
    this.listKeys.forEach((key) => {
      const confirmedEnd = this.confirmedListRangeEnds.get(key) ?? -1;
      if (confirmedEnd < 0) return;

      const requestedEnd = getListEndIndex(this.slidingSync.getListParams(key));
      if (requestedEnd <= confirmedEnd) return;

      this.slidingSync.setListRanges(key, [[0, confirmedEnd]]);
      this.requestedListRangeEnds.set(key, confirmedEnd);
    });
  }

  public onRoomSubscriptionStatus(
    roomId: string,
    listener: (loading: boolean) => void
  ): () => void {
    const listeners = this.roomSubscriptionStatusListeners.get(roomId) ?? new Set();
    listeners.add(listener);
    this.roomSubscriptionStatusListeners.set(roomId, listeners);
    listener(this.isRoomSubscriptionLoading(roomId));

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.roomSubscriptionStatusListeners.delete(roomId);
    };
  }

  public isRoomSubscriptionLoading(roomId: string): boolean {
    return (
      this.roomSubscriptionLoadingSince.has(roomId) ||
      this.roomDataAwaitingSyncCompletion.has(roomId)
    );
  }

  private notifyRoomSubscriptionStatus(roomId: string, loading: boolean): void {
    this.roomSubscriptionStatusListeners.get(roomId)?.forEach((listener) => listener(loading));
  }

  private addActiveRoomSubscription(roomId: string): boolean {
    if (this.activeRoomSubscriptions.has(roomId)) return false;
    this.activeRoomSubscriptions.add(roomId);
    this.pauseUnconfirmedListExpansion();

    const existingListener = this.pendingRoomDataListeners.get(roomId);
    if (existingListener) {
      this.slidingSync.removeListener(SlidingSyncEvent.RoomData, existingListener);
    }
    // The room is loading until the cycle that delivered its first data completes.
    const onFirstRoomData = (dataRoomId: string) => {
      if (dataRoomId !== roomId) return;
      if (this.hydratingSidebarCache) return;
      this.slidingSync.removeListener(SlidingSyncEvent.RoomData, onFirstRoomData);
      this.pendingRoomDataListeners.delete(roomId);
      this.roomSubscriptionLoadingSince.delete(roomId);
      this.roomDataAwaitingSyncCompletion.add(roomId);
    };
    this.pendingRoomDataListeners.set(roomId, onFirstRoomData);
    this.roomSubscriptionLoadingSince.set(roomId, this.syncCount);
    this.slidingSync.on(SlidingSyncEvent.RoomData, onFirstRoomData);
    this.notifyRoomSubscriptionStatus(roomId, true);
    return true;
  }

  private removeActiveRoomSubscription(roomId: string): boolean {
    if (!this.activeRoomSubscriptions.has(roomId)) return false;
    const pendingListener = this.pendingRoomDataListeners.get(roomId);
    if (pendingListener) {
      this.slidingSync.removeListener(SlidingSyncEvent.RoomData, pendingListener);
      this.pendingRoomDataListeners.delete(roomId);
    }
    this.roomSubscriptionLoadingSince.delete(roomId);
    this.roomDataAwaitingSyncCompletion.delete(roomId);
    this.notifyRoomSubscriptionStatus(roomId, false);
    this.activeRoomSubscriptions.delete(roomId);
    return true;
  }

  public setActiveRoomSubscriptions(roomIds: Iterable<string>): void {
    if (this.disposed) return;
    const next = new Set(roomIds);
    let changed = false;

    this.activeRoomSubscriptions.forEach((roomId) => {
      if (!next.has(roomId)) changed = this.removeActiveRoomSubscription(roomId) || changed;
    });
    next.forEach((roomId) => {
      if (!this.activeRoomSubscriptions.has(roomId)) {
        changed = this.addActiveRoomSubscription(roomId) || changed;
      }
    });

    if (changed) this.syncRoomSubscriptions();
  }

  public getActiveRoomSubscriptionIds(): string[] {
    return [...this.activeRoomSubscriptions];
  }

  public subscribeToRoom(roomId: string): void {
    if (this.disposed || !this.addActiveRoomSubscription(roomId)) return;
    this.syncRoomSubscriptions();
  }

  public unsubscribeFromRoom(roomId: string): void {
    if (this.disposed || !this.removeActiveRoomSubscription(roomId)) return;
    this.syncRoomSubscriptions();
  }

  /**
   * Subscribes a room with every member for as long as a call runs in it.
   * Returns the function that ends the subscription.
   */
  public subscribeToCallRoom(roomId: string): () => void {
    if (this.disposed) return () => undefined;

    this.callRoomSubscriptions.add(roomId);
    this.syncRoomSubscriptions();
    return () => this.unsubscribeFromCallRoom(roomId);
  }

  public unsubscribeFromCallRoom(roomId: string): void {
    if (this.disposed || !this.callRoomSubscriptions.delete(roomId)) return;
    this.syncRoomSubscriptions();
  }

  /**
   * Keeps the rooms hosting the user's global emoji and sticker packs subscribed
   * with their pack state, which the room lists do not carry.
   */
  public setImagePackSubscriptions(roomIds: Iterable<string>): void {
    if (this.disposed) return;
    const next = new Set(roomIds);
    if (!this.listsFullyLoaded) {
      this.deferredImagePackSubscriptions = next;
      return;
    }
    const unchanged =
      next.size === this.imagePackRoomSubscriptions.size &&
      [...next].every((roomId) => this.imagePackRoomSubscriptions.has(roomId));
    if (unchanged) return;

    this.imagePackRoomSubscriptions.clear();
    next.forEach((roomId) => this.imagePackRoomSubscriptions.add(roomId));
    this.syncRoomSubscriptions();
  }

  /** Listen for raw sliding sync data for one room. */
  public onRoomData(roomId: string, listener: () => void): () => void {
    const handler = (dataRoomId: string) => {
      // Let matrix-js-sdk finish applying the room data before reading state events.
      if (dataRoomId === roomId) setTimeout(listener, 0);
    };
    this.slidingSync.on(SlidingSyncEvent.RoomData, handler);
    return () => this.slidingSync.removeListener(SlidingSyncEvent.RoomData, handler);
  }

  /**
   * Keeps every joined space subscribed with its child and parent state, which the
   * room lists do not carry but the space sidebar and hierarchy need. Applied once
   * the lists are loaded, so the initial room list is not held up by it.
   */
  public setSpaceSubscriptions(roomIds: Iterable<string>): void {
    if (this.disposed) return;
    const next = new Set(roomIds);
    if (!this.listsFullyLoaded) {
      this.deferredSpaceSubscriptions = next;
      return;
    }
    const unchanged =
      next.size === this.spaceSubscriptions.size &&
      [...next].every((roomId) => this.spaceSubscriptions.has(roomId));
    if (unchanged) return;

    this.spaceSubscriptions.clear();
    next.forEach((roomId) => this.spaceSubscriptions.add(roomId));
    this.syncRoomSubscriptions();
  }
}

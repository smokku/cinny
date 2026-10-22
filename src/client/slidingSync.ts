import {
  EventStatus,
  EventTimeline,
  EventTimelineSet,
  EventType,
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
const SPACE_SUBSCRIPTION_KEY = 'space';
const ACTIVE_ROOM_TIMELINE_LIMIT = 50;

type SlidingSyncOptions = {
  timelineLimit?: number;
  pollTimeoutMs?: number;
  initialRoomIds?: Iterable<string>;
};

const clampPositive = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return fallback;
  return Math.round(value);
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

  private readonly spaceSubscriptions = new Set<string>();

  private deferredSpaceSubscriptions = new Set<string>();

  private roomSubscriptionSyncQueued = false;

  private readonly roomTimelineLimit: number;

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
    this.slidingSync.addCustomSubscription(SPACE_SUBSCRIPTION_KEY, buildSpaceSubscription());

    this.onLifecycle = (state, resp, err) => {
      if (err) {
        console.warn('Sliding sync error', err);
      }

      if (this.disposed) return;

      this.armPollWatchdog();

      if (err || !resp || state !== SlidingSyncState.Complete) return;

      this.timelineResetCompletions.get(resp)?.();
      this.timelineResetCompletions.delete(resp);

      this.requestedListRangeEnds.forEach((rangeEnd, key) => {
        this.confirmedListRangeEnds.set(key, rangeEnd);
      });

      this.initialSyncCompleted = true;

      this.expandListsByPage();
      this.ensureListCoverage();
    };

    this.onMembershipLeave = (_event, member) => {
      if (member.userId !== this.mx.getUserId()) return;
      if (member.membership !== KnownMembership.Leave && member.membership !== KnownMembership.Ban)
        return;
      this.handleRoomLeaveSubscriptions(member.roomId);
    };

    Array.from(options.initialRoomIds ?? []).forEach((roomId) => this.subscribeToRoom(roomId));
  }

  public attach(): void {
    this.slidingSync.on(SlidingSyncEvent.Lifecycle, this.onLifecycle);
    this.mx.on(RoomMemberEvent.Membership, this.onMembershipLeave);

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

    this.disposed = true;
    clearTimeout(this.pollWatchdogTimer);
    this.pollWatchdogTimer = undefined;
    this.slidingSync.stop();
    this.slidingSync.removeListener(SlidingSyncEvent.Lifecycle, this.onLifecycle);
    this.mx.removeListener(RoomMemberEvent.Membership, this.onMembershipLeave);
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
    });

    if (allListsComplete && !this.listsFullyLoaded) {
      this.listsFullyLoaded = true;
      this.initialListHydrationCompleted = true;
      setTimeout(() => this.flushDeferredSubscriptions(), 0);
    }
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

  private handleRoomLeaveSubscriptions(roomId: string): void {
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
    this.deferredSpaceSubscriptions.delete(roomId);
    return removedSpace;
  }

  private flushDeferredSubscriptions(): void {
    if (this.disposed || !this.listsFullyLoaded) return;

    const spaces = this.deferredSpaceSubscriptions;
    this.deferredSpaceSubscriptions = new Set();
    this.setSpaceSubscriptions(spaces);
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
    [this.activeRoomSubscriptions, this.spaceSubscriptions].forEach((group) =>
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
      if (this.activeRoomSubscriptions.has(roomId)) {
        this.slidingSync.useCustomSubscription(roomId, ACTIVE_ROOM_SUBSCRIPTION_KEY);
      } else {
        this.slidingSync.useCustomSubscription(roomId, SPACE_SUBSCRIPTION_KEY);
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

  private addActiveRoomSubscription(roomId: string): boolean {
    if (this.activeRoomSubscriptions.has(roomId)) return false;
    this.activeRoomSubscriptions.add(roomId);
    this.pauseUnconfirmedListExpansion();
    return true;
  }

  private removeActiveRoomSubscription(roomId: string): boolean {
    return this.activeRoomSubscriptions.delete(roomId);
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

import produce from 'immer';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import {
  ClientEvent,
  IRoomTimelineData,
  MatrixClient,
  MatrixEvent,
  MatrixEventEvent,
  NotificationCountType,
  Room,
  RoomEvent,
  SyncState,
} from 'matrix-js-sdk';
import { Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Membership,
  NotificationType,
  RoomToThreadUnread,
  RoomToUnread,
  StateEvent,
  ThreadUnread,
  Unread,
  UnreadInfo,
} from '../../../types/matrix/room';
import {
  getAllParents,
  getNotificationType,
  getUnreadInfo,
  getUnreadInfos,
  isNotificationEvent,
  roomHaveUnread,
} from '../../utils/room';
import { AccountDataEvent } from '../../../types/matrix/accountData';
import { useStateEventCallback } from '../../hooks/useStateEventCallback';
import { useSyncState } from '../../hooks/useSyncState';
import { getThreadUnreadCounts } from '../../utils/thread';
import { roomToParentsByAccountAtom } from './roomToParents';
import { roomOwnerByRoomIdAtom } from '../sessions';

const STABLE_UNREAD_THREAD_NOTIFICATIONS = 'unread_thread_notifications';
const UNSTABLE_UNREAD_THREAD_NOTIFICATIONS = 'org.matrix.msc3773.unread_thread_notifications';
const READ_RECEIPT = 'm.read';
const PRIVATE_READ_RECEIPT = 'm.read.private';
const MAIN_TIMELINE_THREAD_ID = 'main';

type SavedUnreadNotification = {
  notification_count?: number;
  highlight_count?: number;
};

type SavedJoinedRoom = {
  [STABLE_UNREAD_THREAD_NOTIFICATIONS]?: Record<string, SavedUnreadNotification>;
  [UNSTABLE_UNREAD_THREAD_NOTIFICATIONS]?: Record<string, SavedUnreadNotification>;
};

type SavedSync = {
  roomsData?: {
    join?: Record<string, SavedJoinedRoom>;
  };
};

type ReceiptLike = {
  thread_id?: string;
};

type ReceiptContentLike = Record<
  string,
  Record<string, Record<string, ReceiptLike | undefined> | undefined> | undefined
>;

type ReceiptTargets = {
  hasRoomReceipt: boolean;
  hasUnthreadedReceipt: boolean;
  threadIds: Set<string>;
};

type ThreadUnreadCounts = {
  total: number;
  highlight: number;
  hasUnread: boolean;
};

type ThreadUnreadLike = {
  total: number;
  highlight: number;
  order: number;
};

type UnreadNotifications = Partial<Record<NotificationCountType, number>>;
type HandleUnreadNotifications = (
  unreadNotifications?: UnreadNotifications,
  threadId?: string
) => void;
type HandleReceipt = (mEvent: MatrixEvent, room: Room) => void;

export type RoomToUnreadAction =
  | {
      type: 'RESET';
      unreadInfos: UnreadInfo[];
    }
  | {
      type: 'PUT';
      unreadInfo: UnreadInfo;
    }
  | {
      type: 'DELETE';
      roomId: string;
    };

export type RoomToThreadUnreadAction =
  | {
      type: 'RESET';
      roomToThreadUnread: RoomToThreadUnread;
    }
  | {
      type: 'SET_ROOM';
      roomId: string;
      threadToUnread: Map<string, ThreadUnread>;
    }
  | {
      type: 'PUT';
      roomId: string;
      threadId: string;
      unread: ThreadUnread;
    }
  | {
      type: 'DELETE';
      roomId: string;
      threadId: string;
    }
  | {
      type: 'DELETE_ROOM';
      roomId: string;
    };

export const unreadInfoToUnread = (unreadInfo: UnreadInfo): Unread => ({
  highlight: unreadInfo.highlight,
  total: unreadInfo.total,
  from: null,
});

const putUnreadInfo = (
  roomToUnread: RoomToUnread,
  allParents: Set<string>,
  unreadInfo: UnreadInfo
) => {
  const oldUnread = roomToUnread.get(unreadInfo.roomId) ?? { highlight: 0, total: 0, from: null };
  roomToUnread.set(unreadInfo.roomId, unreadInfoToUnread(unreadInfo));

  const newH = unreadInfo.highlight - oldUnread.highlight;
  const newT = unreadInfo.total - oldUnread.total;

  allParents.forEach((parentId) => {
    const oldParentUnread = roomToUnread.get(parentId) ?? { highlight: 0, total: 0, from: null };
    roomToUnread.set(parentId, {
      highlight: (oldParentUnread.highlight += newH),
      total: (oldParentUnread.total += newT),
      from: new Set([...(oldParentUnread.from ?? []), unreadInfo.roomId]),
    });
  });
};

const deleteUnreadInfo = (roomToUnread: RoomToUnread, allParents: Set<string>, roomId: string) => {
  const oldUnread = roomToUnread.get(roomId);
  if (!oldUnread) return;
  roomToUnread.delete(roomId);

  allParents.forEach((parentId) => {
    const oldParentUnread = roomToUnread.get(parentId);
    if (!oldParentUnread) return;
    const newFrom = new Set([...(oldParentUnread.from ?? [roomId])]);
    newFrom.delete(roomId);
    if (newFrom.size === 0) {
      roomToUnread.delete(parentId);
      return;
    }
    roomToUnread.set(parentId, {
      highlight: oldParentUnread.highlight - oldUnread.highlight,
      total: oldParentUnread.total - oldUnread.total,
      from: newFrom,
    });
  });
};

export const unreadEqual = (u1: Unread, u2: Unread): boolean => {
  const countEqual = u1.highlight === u2.highlight && u1.total === u2.total;

  if (!countEqual) return false;

  const f1 = u1.from;
  const f2 = u2.from;
  if (f1 === null && f2 === null) return true;
  if (f1 === null || f2 === null) return false;

  if (f1.size !== f2.size) return false;

  let fromEqual = true;
  f1.forEach((item) => {
    if (!f2.has(item)) {
      fromEqual = false;
    }
  });

  return fromEqual;
};

export const threadUnreadEqual = (t1: ThreadUnread, t2: ThreadUnread): boolean =>
  t1.highlight === t2.highlight && t1.total === t2.total && t1.order === t2.order;

export const roomThreadUnreadEqual = (
  t1?: Map<string, ThreadUnread>,
  t2?: Map<string, ThreadUnread>
): boolean => {
  if (!t1 && !t2) return true;
  if (!t1 || !t2) return false;
  if (t1.size !== t2.size) return false;

  return Array.from(t1.entries()).every(([threadId, unread]) => {
    const other = t2.get(threadId);
    return !!other && threadUnreadEqual(unread, other);
  });
};

const putThreadUnread = (
  roomToThreadUnread: RoomToThreadUnread,
  roomId: string,
  threadId: string,
  unread: ThreadUnread
) => {
  const roomThreads = roomToThreadUnread.get(roomId) ?? new Map<string, ThreadUnread>();
  roomThreads.set(threadId, unread);
  roomToThreadUnread.set(roomId, roomThreads);
};

const setRoomThreadUnread = (
  roomToThreadUnread: RoomToThreadUnread,
  roomId: string,
  threadToUnread: Map<string, ThreadUnread>
) => {
  if (threadToUnread.size === 0) {
    roomToThreadUnread.delete(roomId);
    return;
  }

  roomToThreadUnread.set(roomId, new Map(threadToUnread));
};

const deleteThreadUnread = (
  roomToThreadUnread: RoomToThreadUnread,
  roomId: string,
  threadId: string
) => {
  const roomThreads = roomToThreadUnread.get(roomId);
  if (!roomThreads) return;

  roomThreads.delete(threadId);
  if (roomThreads.size === 0) {
    roomToThreadUnread.delete(roomId);
    return;
  }

  roomToThreadUnread.set(roomId, roomThreads);
};

const deleteRoomThreadUnread = (roomToThreadUnread: RoomToThreadUnread, roomId: string) => {
  roomToThreadUnread.delete(roomId);
};

const shouldKeepThreadUnread = (
  notificationType: NotificationType,
  total: number,
  highlight: number,
  hasUnread: boolean
): boolean => {
  if (notificationType === NotificationType.Mute) return false;
  if (notificationType === NotificationType.MentionsAndKeywords) return highlight > 0;
  return total > 0 || hasUnread;
};

const getReceiptTargets = (content: ReceiptContentLike, myUserId: string): ReceiptTargets => {
  let hasRoomReceipt = false;
  let hasUnthreadedReceipt = false;
  const threadIds = new Set<string>();

  Object.values(content).forEach((receiptGroup) => {
    if (!receiptGroup) return;

    Object.entries(receiptGroup).forEach(([receiptType, userReceipts]) => {
      if (receiptType !== READ_RECEIPT && receiptType !== PRIVATE_READ_RECEIPT) return;
      const receipt = userReceipts?.[myUserId];
      if (!receipt) return;

      const threadId = receipt.thread_id;
      if (!threadId) {
        hasUnthreadedReceipt = true;
        hasRoomReceipt = true;
        return;
      }

      if (threadId === MAIN_TIMELINE_THREAD_ID) {
        hasRoomReceipt = true;
        return;
      }

      threadIds.add(threadId);
    });
  });

  return { hasRoomReceipt, hasUnthreadedReceipt, threadIds };
};

const rebuildThreadUnreadMap = <T extends ThreadUnreadLike>(
  threadIds: Iterable<string>,
  getThreadCounts: (threadId: string) => ThreadUnreadCounts,
  notificationType: NotificationType,
  previousRoomThreads: Map<string, T> | undefined,
  getNextOrder: () => number
): Map<string, T> => {
  const nextRoomThreads = new Map<string, T>();

  Array.from(new Set(threadIds)).forEach((threadId) => {
    const { total, highlight, hasUnread } = getThreadCounts(threadId);
    if (!shouldKeepThreadUnread(notificationType, total, highlight, hasUnread)) return;

    nextRoomThreads.set(threadId, {
      total,
      highlight,
      order: previousRoomThreads?.get(threadId)?.order ?? getNextOrder(),
    } as T);
  });

  return nextRoomThreads;
};

const getSavedRoomThreadNotifications = (
  joinRoom: SavedJoinedRoom
): Record<string, SavedUnreadNotification> | undefined =>
  joinRoom[STABLE_UNREAD_THREAD_NOTIFICATIONS] ?? joinRoom[UNSTABLE_UNREAD_THREAD_NOTIFICATIONS];

const createThreadUnread = (
  total: number,
  highlight: number,
  notificationType: NotificationType,
  getNextOrder: () => number
): ThreadUnread | undefined => {
  // Server-persisted counts are already authoritative: if the server
  // reports anything non-zero, we have unread.
  const hasUnread = total > 0 || highlight > 0;
  if (!shouldKeepThreadUnread(notificationType, total, highlight, hasUnread)) {
    return undefined;
  }

  return {
    total,
    highlight,
    order: getNextOrder(),
  };
};

const createRoomThreadUnread = (
  room: Room,
  threadId: string,
  previousRoomThreads: Map<string, ThreadUnread> | undefined,
  getNextOrder: () => number
): ThreadUnread | undefined => {
  const myUserId = room.client.getUserId();
  if (!myUserId) return undefined;
  return rebuildThreadUnreadMap(
    [threadId],
    (targetThreadId) => getThreadUnreadCounts(room, targetThreadId, myUserId),
    getNotificationType(room.client, room.roomId),
    previousRoomThreads,
    getNextOrder
  ).get(threadId);
};

const rebuildRoomThreadUnread = (
  room: Room,
  threadIds: Iterable<string>,
  previousRoomThreads: Map<string, ThreadUnread> | undefined,
  getNextOrder: () => number
): Map<string, ThreadUnread> => {
  const myUserId = room.client.getUserId();
  if (!myUserId) return new Map();
  return rebuildThreadUnreadMap(
    threadIds,
    (threadId) => getThreadUnreadCounts(room, threadId, myUserId),
    getNotificationType(room.client, room.roomId),
    previousRoomThreads,
    getNextOrder
  );
};

const getSavedThreadUnread = async (
  mx: MatrixClient,
  getNextOrder: () => number
): Promise<RoomToThreadUnread> => {
  const savedSync = (await mx.store.getSavedSync()) as SavedSync | null;
  const joinRooms = savedSync?.roomsData?.join ?? {};
  const roomToThreadUnread: RoomToThreadUnread = new Map();

  Object.entries(joinRooms).forEach(([roomId, joinRoom]) => {
    const room = mx.getRoom(roomId);
    if (!room || room.isSpaceRoom() || room.getMyMembership() !== Membership.Join) {
      return;
    }

    const unreadThreadNotifications = getSavedRoomThreadNotifications(joinRoom);
    if (!unreadThreadNotifications) return;

    const notificationType = getNotificationType(mx, roomId);
    if (notificationType === NotificationType.Mute) return;

    const roomThreads = new Map<string, ThreadUnread>();
    Object.entries(unreadThreadNotifications).forEach(([threadId, notification]) => {
      const threadUnread = createThreadUnread(
        notification.notification_count ?? 0,
        notification.highlight_count ?? 0,
        notificationType,
        getNextOrder
      );
      if (threadUnread) {
        roomThreads.set(threadId, threadUnread);
      }
    });

    if (roomThreads.size > 0) {
      roomToThreadUnread.set(roomId, roomThreads);
    }
  });

  return roomToThreadUnread;
};

// ---------------------------------------------------------------------------
// Per-account storage
// ---------------------------------------------------------------------------
export const roomToUnreadByAccountAtom = atom<Map<string, RoomToUnread>>(new Map());
export const roomToThreadUnreadByAccountAtom = atom<Map<string, RoomToThreadUnread>>(new Map());

const accountUnreadCache = new Map<string, ReturnType<typeof createAccountUnreadAtom>>();
const accountThreadUnreadCache = new Map<
  string,
  ReturnType<typeof createAccountThreadUnreadAtom>
>();

function createAccountUnreadAtom(userId: string) {
  return atom<RoomToUnread, [RoomToUnreadAction], void>(
    (get) => get(roomToUnreadByAccountAtom).get(userId) ?? new Map(),
    (get, set, action) => {
      const accountParents = get(roomToParentsByAccountAtom).get(userId) ?? new Map();

      if (action.type === 'RESET') {
        const draftRoomToUnread: RoomToUnread = new Map();
        action.unreadInfos.forEach((unreadInfo) => {
          putUnreadInfo(
            draftRoomToUnread,
            getAllParents(accountParents, unreadInfo.roomId),
            unreadInfo
          );
        });
        set(roomToUnreadByAccountAtom, (prev) => {
          const next = new Map(prev);
          next.set(userId, draftRoomToUnread);
          return next;
        });
        return;
      }
      if (action.type === 'PUT') {
        const { unreadInfo } = action;
        const current = get(roomToUnreadByAccountAtom).get(userId) ?? new Map();
        const currentUnread = current.get(unreadInfo.roomId);
        if (currentUnread && unreadEqual(currentUnread, unreadInfoToUnread(unreadInfo))) {
          return;
        }
        set(roomToUnreadByAccountAtom, (prev) => {
          const next = new Map(prev);
          next.set(
            userId,
            produce(prev.get(userId) ?? new Map(), (draft) =>
              putUnreadInfo(draft, getAllParents(accountParents, unreadInfo.roomId), unreadInfo)
            )
          );
          return next;
        });
        return;
      }
      if (action.type === 'DELETE') {
        const current = get(roomToUnreadByAccountAtom).get(userId);
        if (!current?.has(action.roomId)) return;
        set(roomToUnreadByAccountAtom, (prev) => {
          const next = new Map(prev);
          next.set(
            userId,
            produce(prev.get(userId) ?? new Map(), (draft) =>
              deleteUnreadInfo(draft, getAllParents(accountParents, action.roomId), action.roomId)
            )
          );
          return next;
        });
      }
    }
  );
}

function createAccountThreadUnreadAtom(userId: string) {
  return atom<RoomToThreadUnread, [RoomToThreadUnreadAction], void>(
    (get) => get(roomToThreadUnreadByAccountAtom).get(userId) ?? new Map(),
    (get, set, action) => {
      const current = get(roomToThreadUnreadByAccountAtom).get(userId) ?? new Map();

      if (action.type === 'RESET') {
        set(roomToThreadUnreadByAccountAtom, (prev) => {
          const next = new Map(prev);
          next.set(userId, action.roomToThreadUnread);
          return next;
        });
        return;
      }

      let updated: RoomToThreadUnread | undefined;

      if (action.type === 'SET_ROOM') {
        const currentThreads = current.get(action.roomId);
        if (roomThreadUnreadEqual(currentThreads, action.threadToUnread)) return;
        updated = produce(current, (draft) =>
          setRoomThreadUnread(draft, action.roomId, action.threadToUnread)
        );
      }

      if (action.type === 'PUT') {
        const currentThread = current.get(action.roomId)?.get(action.threadId);
        if (currentThread && threadUnreadEqual(currentThread, action.unread)) return;
        updated = produce(current, (draft) =>
          putThreadUnread(draft, action.roomId, action.threadId, action.unread)
        );
      }

      if (action.type === 'DELETE') {
        if (!current.get(action.roomId)?.has(action.threadId)) return;
        updated = produce(current, (draft) =>
          deleteThreadUnread(draft, action.roomId, action.threadId)
        );
      }

      if (action.type === 'DELETE_ROOM') {
        if (!current.has(action.roomId)) return;
        updated = produce(current, (draft) => deleteRoomThreadUnread(draft, action.roomId));
      }

      if (updated) {
        const finalUpdated = updated;
        set(roomToThreadUnreadByAccountAtom, (prev) => {
          const next = new Map(prev);
          next.set(userId, finalUpdated);
          return next;
        });
      }
    }
  );
}

export function getAccountUnreadAtom(userId: string) {
  let a = accountUnreadCache.get(userId);
  if (!a) {
    a = createAccountUnreadAtom(userId);
    accountUnreadCache.set(userId, a);
  }
  return a;
}

export function getAccountThreadUnreadAtom(userId: string) {
  let a = accountThreadUnreadCache.get(userId);
  if (!a) {
    a = createAccountThreadUnreadAtom(userId);
    accountThreadUnreadCache.set(userId, a);
  }
  return a;
}

// ---------------------------------------------------------------------------
// Aggregated read-only atoms (owner takes precedence for shared rooms)
// ---------------------------------------------------------------------------
export const roomToUnreadAtom = atom<RoomToUnread>((get) => {
  const byAccount = get(roomToUnreadByAccountAtom);
  const ownerMap = get(roomOwnerByRoomIdAtom);
  const merged: RoomToUnread = new Map();

  // First pass: fill with any account's data
  byAccount.forEach((accountUnread) => {
    accountUnread.forEach((unread, roomId) => {
      if (!merged.has(roomId)) {
        merged.set(roomId, unread);
      }
    });
  });

  // Second pass: owner overrides
  byAccount.forEach((accountUnread, userId) => {
    accountUnread.forEach((unread, roomId) => {
      if (ownerMap[roomId] === userId) {
        merged.set(roomId, unread);
      }
    });
  });

  return merged;
});

export const roomToThreadUnreadAtom = atom<RoomToThreadUnread>((get) => {
  const byAccount = get(roomToThreadUnreadByAccountAtom);
  const ownerMap = get(roomOwnerByRoomIdAtom);
  const merged: RoomToThreadUnread = new Map();

  byAccount.forEach((accountThreadUnread) => {
    accountThreadUnread.forEach((threadMap, roomId) => {
      if (!merged.has(roomId)) {
        merged.set(roomId, new Map(threadMap));
      }
    });
  });

  byAccount.forEach((accountThreadUnread, userId) => {
    accountThreadUnread.forEach((threadMap, roomId) => {
      if (ownerMap[roomId] === userId) {
        merged.set(roomId, new Map(threadMap));
      }
    });
  });

  return merged;
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
export const removeAccountUnreadAtom = atom(null, (_get, set, userId: string) => {
  set(roomToUnreadByAccountAtom, (prev) => {
    const next = new Map(prev);
    next.delete(userId);
    return next;
  });
  set(roomToThreadUnreadByAccountAtom, (prev) => {
    const next = new Map(prev);
    next.delete(userId);
    return next;
  });
});

export const useBindRoomToUnreadAtom = (mx: MatrixClient) => {
  const userId = mx.getSafeUserId();
  const accountUnreadAtom = useMemo(() => getAccountUnreadAtom(userId), [userId]);
  const accountThreadUnreadAtom = useMemo(() => getAccountThreadUnreadAtom(userId), [userId]);

  const setUnreadAtom = useSetAtom(accountUnreadAtom);
  const setThreadUnreadAtom = useSetAtom(accountThreadUnreadAtom);
  const roomToThreadUnread = useAtomValue(accountThreadUnreadAtom);
  const nextThreadOrderRef = useRef(1);
  const roomToThreadUnreadRef = useRef(roomToThreadUnread);
  const pendingThreadResetRef = useRef<Map<string, Set<string>>>(new Map());

  const getNextThreadOrder = useCallback((): number => {
    const nextOrder = nextThreadOrderRef.current;
    nextThreadOrderRef.current += 1;
    return nextOrder;
  }, []);

  useEffect(() => {
    roomToThreadUnreadRef.current = roomToThreadUnread;
  }, [roomToThreadUnread]);

  const resetRoomUnread = useCallback(() => {
    setUnreadAtom({
      type: 'RESET',
      unreadInfos: getUnreadInfos(mx),
    });
  }, [mx, setUnreadAtom]);

  const seedThreadUnread = useCallback(async (): Promise<void> => {
    const seeded = await getSavedThreadUnread(mx, getNextThreadOrder);

    // Layer client-side fallback entries on top of the server-reported map
    // for homeservers that don't publish per-thread notification counters.
    // Scope: only covers rooms whose Thread objects are already hydrated in
    // the SDK.  Older-than-initial-sync threads in unvisited rooms will
    // appear later when the user opens those rooms' thread browser.
    const myUserId = mx.getUserId();
    if (myUserId) {
      mx.getRooms().forEach((room) => {
        if (room.isSpaceRoom() || room.getMyMembership() !== Membership.Join) return;
        const notificationType = getNotificationType(mx, room.roomId);
        if (notificationType === NotificationType.Mute) return;

        room.getThreads().forEach((thread) => {
          // Server-seeded entries win — only fill gaps from the fallback.
          if (seeded.get(room.roomId)?.has(thread.id)) return;

          const counts = getThreadUnreadCounts(room, thread.id, myUserId);
          if (
            !shouldKeepThreadUnread(
              notificationType,
              counts.total,
              counts.highlight,
              counts.hasUnread
            )
          ) {
            return;
          }

          const roomThreads = seeded.get(room.roomId) ?? new Map<string, ThreadUnread>();
          roomThreads.set(thread.id, {
            total: counts.total,
            highlight: counts.highlight,
            order: getNextThreadOrder(),
          });
          seeded.set(room.roomId, roomThreads);
        });
      });
    }

    setThreadUnreadAtom({
      type: 'RESET',
      roomToThreadUnread: seeded,
    });
  }, [getNextThreadOrder, mx, setThreadUnreadAtom]);

  const rebuildTrackedThreadUnread = useCallback(() => {
    const currentRoomToThreadUnread = roomToThreadUnreadRef.current;
    const nextRoomToThreadUnread: RoomToThreadUnread = new Map();

    currentRoomToThreadUnread.forEach((roomThreads, roomId) => {
      const room = mx.getRoom(roomId);
      if (!room || room.isSpaceRoom() || room.getMyMembership() !== Membership.Join) {
        return;
      }

      const nextRoomThreads = rebuildRoomThreadUnread(
        room,
        roomThreads.keys(),
        roomThreads,
        getNextThreadOrder
      );
      if (nextRoomThreads.size > 0) {
        nextRoomToThreadUnread.set(roomId, nextRoomThreads);
      }
    });

    setThreadUnreadAtom({
      type: 'RESET',
      roomToThreadUnread: nextRoomToThreadUnread,
    });
  }, [getNextThreadOrder, mx, setThreadUnreadAtom]);

  useEffect(() => {
    resetRoomUnread();
    seedThreadUnread().catch(() => undefined);
  }, [resetRoomUnread, seedThreadUnread]);

  useSyncState(
    mx,
    useCallback(
      (state: SyncState, prevState: SyncState | null) => {
        if (state === SyncState.Prepared && prevState === null) {
          resetRoomUnread();
          return;
        }

        if (state === SyncState.Syncing && prevState !== SyncState.Syncing) {
          resetRoomUnread();
          rebuildTrackedThreadUnread();
        }
      },
      [rebuildTrackedThreadUnread, resetRoomUnread]
    )
  );

  useEffect(() => {
    const handleTimelineEvent = (
      mEvent: MatrixEvent,
      room: Room | undefined,
      toStartOfTimeline: boolean | undefined,
      removed: boolean,
      data: IRoomTimelineData
    ) => {
      if (!room || !data.liveEvent || room.isSpaceRoom() || !isNotificationEvent(mEvent)) return;
      const notificationType = getNotificationType(mx, room.roomId);
      if (notificationType === NotificationType.Mute) {
        setUnreadAtom({
          type: 'DELETE',
          roomId: room.roomId,
        });
        return;
      }

      if (mEvent.getSender() === mx.getUserId()) return;

      const unreadInfo = getUnreadInfo(room);
      if (
        notificationType === NotificationType.MentionsAndKeywords &&
        unreadInfo.total === 0 &&
        unreadInfo.highlight === 0
      ) {
        return;
      }
      if (unreadInfo.total === 0 && unreadInfo.highlight === 0 && !roomHaveUnread(mx, room)) {
        return;
      }
      setUnreadAtom({ type: 'PUT', unreadInfo });
    };
    mx.on(RoomEvent.Timeline, handleTimelineEvent);
    return () => {
      mx.removeListener(RoomEvent.Timeline, handleTimelineEvent);
    };
  }, [mx, setUnreadAtom]);

  useEffect(() => {
    const handleDecrypted = (mEvent: MatrixEvent) => {
      if (mEvent.isDecryptionFailure()) return;
      if (!isNotificationEvent(mEvent)) return;

      const roomId = mEvent.getRoomId();
      if (!roomId) return;
      const room = mx.getRoom(roomId);
      if (!room || room.isSpaceRoom()) return;

      const notificationType = getNotificationType(mx, room.roomId);
      if (notificationType === NotificationType.Mute) return;

      if (mEvent.getSender() === mx.getUserId()) return;

      const unreadInfo = getUnreadInfo(room);
      if (
        notificationType === NotificationType.MentionsAndKeywords &&
        unreadInfo.total === 0 &&
        unreadInfo.highlight === 0
      ) {
        return;
      }
      if (unreadInfo.total === 0 && unreadInfo.highlight === 0 && !roomHaveUnread(mx, room)) {
        return;
      }
      setUnreadAtom({ type: 'PUT', unreadInfo });
    };
    mx.on(MatrixEventEvent.Decrypted, handleDecrypted);
    return () => {
      mx.removeListener(MatrixEventEvent.Decrypted, handleDecrypted);
    };
  }, [mx, setUnreadAtom]);

  useEffect(() => {
    type HandleNewReply = (thread: Thread) => void;
    const pendingThreadResets = pendingThreadResetRef.current;
    const roomHandlers = new Map<
      string,
      {
        room: Room;
        handleUnreadNotifications: HandleUnreadNotifications;
        handleReceipt: HandleReceipt;
        handleNewReply: HandleNewReply;
      }
    >();

    const flushPendingThreadReset = (room: Room) => {
      const pendingThreadIds = pendingThreadResets.get(room.roomId);
      if (!pendingThreadIds) return;

      pendingThreadResets.delete(room.roomId);
      setThreadUnreadAtom({
        type: 'SET_ROOM',
        roomId: room.roomId,
        threadToUnread: rebuildRoomThreadUnread(
          room,
          pendingThreadIds,
          roomToThreadUnreadRef.current.get(room.roomId),
          getNextThreadOrder
        ),
      });
    };

    const startPendingThreadReset = (room: Room) => {
      if (pendingThreadResets.has(room.roomId)) return;

      pendingThreadResets.set(
        room.roomId,
        new Set(roomToThreadUnreadRef.current.get(room.roomId)?.keys() ?? [])
      );
      queueMicrotask(() => flushPendingThreadReset(room));
    };

    const handleThreadUnreadUpdate = (room: Room, threadId: string) => {
      const pendingThreadIds = pendingThreadResets.get(room.roomId);
      if (pendingThreadIds) {
        pendingThreadIds.add(threadId);
        return;
      }

      const currentRoomThreads = roomToThreadUnreadRef.current.get(room.roomId);
      const threadUnread = createRoomThreadUnread(
        room,
        threadId,
        currentRoomThreads,
        getNextThreadOrder
      );
      if (threadUnread) {
        setThreadUnreadAtom({
          type: 'PUT',
          roomId: room.roomId,
          threadId,
          unread: threadUnread,
        });
        return;
      }

      setThreadUnreadAtom({
        type: 'DELETE',
        roomId: room.roomId,
        threadId,
      });
    };

    const bindRoom = (room: Room) => {
      if (roomHandlers.has(room.roomId)) return;
      if (room.isSpaceRoom() || room.getMyMembership() !== Membership.Join) return;

      const handleUnreadNotifications: HandleUnreadNotifications = (
        unreadNotifications,
        threadId
      ) => {
        if (threadId) {
          handleThreadUnreadUpdate(room, threadId);
          return;
        }

        // Room-level counters changed (read receipt landed, counts dropped,
        // or the SDK signalled a reset with `unreadNotifications=undefined`).
        // Refresh `roomToUnreadAtom` immediately so downstream consumers
        // (e.g. the Inbox avatar badge) recompute against the fresh SDK
        // counts instead of waiting for a later timeline event or a
        // room-level receipt that some servers never emit.
        const notificationType = getNotificationType(mx, room.roomId);
        if (notificationType === NotificationType.Mute) {
          setUnreadAtom({ type: 'DELETE', roomId: room.roomId });
        } else {
          const unreadInfo = getUnreadInfo(room);
          if (unreadInfo.total === 0 && unreadInfo.highlight === 0) {
            setUnreadAtom({ type: 'DELETE', roomId: room.roomId });
          } else {
            setUnreadAtom({ type: 'PUT', unreadInfo });
          }
        }

        if (!unreadNotifications) {
          startPendingThreadReset(room);
        }
      };

      const handleReceipt: HandleReceipt = (mEvent, receiptRoom) => {
        if (receiptRoom.roomId !== room.roomId) return;

        const myUserId = mx.getUserId();
        if (!myUserId) return;

        const { hasRoomReceipt, hasUnthreadedReceipt, threadIds } = getReceiptTargets(
          mEvent.getContent<ReceiptContentLike>(),
          myUserId
        );

        if (hasRoomReceipt) {
          setUnreadAtom({ type: 'DELETE', roomId: room.roomId });
        }

        if (hasUnthreadedReceipt) {
          setThreadUnreadAtom({
            type: 'DELETE_ROOM',
            roomId: room.roomId,
          });
          return;
        }

        threadIds.forEach((threadId) => {
          setThreadUnreadAtom({
            type: 'DELETE',
            roomId: room.roomId,
            threadId,
          });
        });
      };

      const handleNewReply: HandleNewReply = (thread) => {
        const lastEvent = thread.lastReply();
        if (!lastEvent) return;
        if (lastEvent.getSender() === mx.getUserId()) return;

        const notificationType = getNotificationType(mx, room.roomId);
        if (notificationType === NotificationType.Mute) return;

        const eventId = lastEvent.getId();
        const userId = mx.getUserId();
        if (!eventId || !userId) return;
        if (room.hasUserReadEvent(userId, eventId)) return;

        handleThreadUnreadUpdate(room, thread.id);
      };

      room.on(RoomEvent.UnreadNotifications, handleUnreadNotifications);
      room.on(RoomEvent.Receipt, handleReceipt);
      room.on(ThreadEvent.NewReply, handleNewReply);
      roomHandlers.set(room.roomId, {
        room,
        handleUnreadNotifications,
        handleReceipt,
        handleNewReply,
      });
    };

    const unbindRoom = (roomId: string) => {
      const handlers = roomHandlers.get(roomId);
      if (!handlers) return;

      handlers.room.off(RoomEvent.UnreadNotifications, handlers.handleUnreadNotifications);
      handlers.room.off(RoomEvent.Receipt, handlers.handleReceipt);
      handlers.room.off(ThreadEvent.NewReply, handlers.handleNewReply);
      roomHandlers.delete(roomId);
      pendingThreadResets.delete(roomId);
    };

    mx.getRooms().forEach(bindRoom);

    const handleMembershipChange = (room: Room, membership: string) => {
      if (membership === Membership.Join) {
        bindRoom(room);
        return;
      }

      unbindRoom(room.roomId);
      setUnreadAtom({
        type: 'DELETE',
        roomId: room.roomId,
      });
      setThreadUnreadAtom({
        type: 'DELETE_ROOM',
        roomId: room.roomId,
      });
    };

    mx.on(RoomEvent.MyMembership, handleMembershipChange);

    return () => {
      mx.removeListener(RoomEvent.MyMembership, handleMembershipChange);
      roomHandlers.forEach((handlers) => {
        handlers.room.off(RoomEvent.UnreadNotifications, handlers.handleUnreadNotifications);
        handlers.room.off(RoomEvent.Receipt, handlers.handleReceipt);
        handlers.room.off(ThreadEvent.NewReply, handlers.handleNewReply);
      });
      roomHandlers.clear();
      pendingThreadResets.clear();
    };
  }, [getNextThreadOrder, mx, setThreadUnreadAtom, setUnreadAtom]);

  // Rebuild unread state when push rules change (replaces React context dependency
  // so this hook can run outside the RoomsNotificationPreferencesProvider tree).
  useEffect(() => {
    const handleAccountData = (event: MatrixEvent) => {
      if (event.getType() === AccountDataEvent.PushRules) {
        resetRoomUnread();
        rebuildTrackedThreadUnread();
      }
    };
    mx.on(ClientEvent.AccountData, handleAccountData);
    return () => {
      mx.removeListener(ClientEvent.AccountData, handleAccountData);
    };
  }, [mx, resetRoomUnread, rebuildTrackedThreadUnread]);

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (mEvent.getType() === StateEvent.SpaceChild) {
          resetRoomUnread();
        }
      },
      [resetRoomUnread]
    )
  );
};

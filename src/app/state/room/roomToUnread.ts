import produce from 'immer';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import {
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
import { useCallback, useEffect, useRef } from 'react';
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
import { useRoomsNotificationPreferencesContext } from '../../hooks/useRoomsNotificationPreferences';
import { useStateEventCallback } from '../../hooks/useStateEventCallback';
import { useSyncState } from '../../hooks/useSyncState';
import { roomToParentsAtom } from './roomToParents';

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
  highlight: number
): boolean => {
  if (notificationType === NotificationType.Mute) return false;
  if (notificationType === NotificationType.MentionsAndKeywords) return highlight > 0;
  return total > 0;
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
    const { total, highlight } = getThreadCounts(threadId);
    if (!shouldKeepThreadUnread(notificationType, total, highlight)) return;

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
  if (!shouldKeepThreadUnread(notificationType, total, highlight)) {
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
): ThreadUnread | undefined =>
  rebuildThreadUnreadMap(
    [threadId],
    (targetThreadId) => ({
      total: room.getThreadUnreadNotificationCount(targetThreadId, NotificationCountType.Total),
      highlight: room.getThreadUnreadNotificationCount(
        targetThreadId,
        NotificationCountType.Highlight
      ),
    }),
    getNotificationType(room.client, room.roomId),
    previousRoomThreads,
    getNextOrder
  ).get(threadId);

const rebuildRoomThreadUnread = (
  room: Room,
  threadIds: Iterable<string>,
  previousRoomThreads: Map<string, ThreadUnread> | undefined,
  getNextOrder: () => number
): Map<string, ThreadUnread> =>
  rebuildThreadUnreadMap(
    threadIds,
    (threadId) => ({
      total: room.getThreadUnreadNotificationCount(threadId, NotificationCountType.Total),
      highlight: room.getThreadUnreadNotificationCount(threadId, NotificationCountType.Highlight),
    }),
    getNotificationType(room.client, room.roomId),
    previousRoomThreads,
    getNextOrder
  );

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

const baseRoomToUnread = atom<RoomToUnread>(new Map());
export const roomToUnreadAtom = atom<RoomToUnread, [RoomToUnreadAction], undefined>(
  (get) => get(baseRoomToUnread),
  (get, set, action) => {
    if (action.type === 'RESET') {
      const draftRoomToUnread: RoomToUnread = new Map();
      action.unreadInfos.forEach((unreadInfo) => {
        putUnreadInfo(
          draftRoomToUnread,
          getAllParents(get(roomToParentsAtom), unreadInfo.roomId),
          unreadInfo
        );
      });
      set(baseRoomToUnread, draftRoomToUnread);
      return;
    }
    if (action.type === 'PUT') {
      const { unreadInfo } = action;
      const currentUnread = get(baseRoomToUnread).get(unreadInfo.roomId);
      if (currentUnread && unreadEqual(currentUnread, unreadInfoToUnread(unreadInfo))) {
        return;
      }
      set(
        baseRoomToUnread,
        produce(get(baseRoomToUnread), (draftRoomToUnread) =>
          putUnreadInfo(
            draftRoomToUnread,
            getAllParents(get(roomToParentsAtom), unreadInfo.roomId),
            unreadInfo
          )
        )
      );
      return;
    }
    if (action.type === 'DELETE' && get(baseRoomToUnread).has(action.roomId)) {
      set(
        baseRoomToUnread,
        produce(get(baseRoomToUnread), (draftRoomToUnread) =>
          deleteUnreadInfo(
            draftRoomToUnread,
            getAllParents(get(roomToParentsAtom), action.roomId),
            action.roomId
          )
        )
      );
    }
  }
);

const baseRoomToThreadUnread = atom<RoomToThreadUnread>(new Map());
export const roomToThreadUnreadAtom = atom<
  RoomToThreadUnread,
  [RoomToThreadUnreadAction],
  undefined
>(
  (get) => get(baseRoomToThreadUnread),
  (get, set, action) => {
    if (action.type === 'RESET') {
      set(baseRoomToThreadUnread, action.roomToThreadUnread);
      return;
    }

    if (action.type === 'SET_ROOM') {
      const currentThreads = get(baseRoomToThreadUnread).get(action.roomId);
      if (roomThreadUnreadEqual(currentThreads, action.threadToUnread)) return;

      set(
        baseRoomToThreadUnread,
        produce(get(baseRoomToThreadUnread), (draftRoomToThreadUnread) =>
          setRoomThreadUnread(draftRoomToThreadUnread, action.roomId, action.threadToUnread)
        )
      );
      return;
    }

    if (action.type === 'PUT') {
      const currentThread = get(baseRoomToThreadUnread).get(action.roomId)?.get(action.threadId);
      if (currentThread && threadUnreadEqual(currentThread, action.unread)) return;

      set(
        baseRoomToThreadUnread,
        produce(get(baseRoomToThreadUnread), (draftRoomToThreadUnread) =>
          putThreadUnread(draftRoomToThreadUnread, action.roomId, action.threadId, action.unread)
        )
      );
      return;
    }

    if (action.type === 'DELETE') {
      if (!get(baseRoomToThreadUnread).get(action.roomId)?.has(action.threadId)) return;

      set(
        baseRoomToThreadUnread,
        produce(get(baseRoomToThreadUnread), (draftRoomToThreadUnread) =>
          deleteThreadUnread(draftRoomToThreadUnread, action.roomId, action.threadId)
        )
      );
      return;
    }

    if (action.type === 'DELETE_ROOM') {
      if (!get(baseRoomToThreadUnread).has(action.roomId)) return;

      set(
        baseRoomToThreadUnread,
        produce(get(baseRoomToThreadUnread), (draftRoomToThreadUnread) =>
          deleteRoomThreadUnread(draftRoomToThreadUnread, action.roomId)
        )
      );
    }
  }
);

export const useBindRoomToUnreadAtom = (mx: MatrixClient, unreadAtom: typeof roomToUnreadAtom) => {
  const setUnreadAtom = useSetAtom(unreadAtom);
  const setThreadUnreadAtom = useSetAtom(roomToThreadUnreadAtom);
  const roomToThreadUnread = useAtomValue(roomToThreadUnreadAtom);
  const roomsNotificationPreferences = useRoomsNotificationPreferencesContext();
  const nextThreadOrderRef = useRef(1);
  const roomToThreadUnreadRef = useRef(roomToThreadUnread);
  const pendingThreadResetRef = useRef<Map<string, Set<string>>>(new Map());
  const previousRoomsNotificationPreferencesRef = useRef(roomsNotificationPreferences);

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
    setThreadUnreadAtom({
      type: 'RESET',
      roomToThreadUnread: await getSavedThreadUnread(mx, getNextThreadOrder),
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

  useEffect(() => {
    if (previousRoomsNotificationPreferencesRef.current === roomsNotificationPreferences) return;

    previousRoomsNotificationPreferencesRef.current = roomsNotificationPreferences;
    resetRoomUnread();
    rebuildTrackedThreadUnread();
  }, [rebuildTrackedThreadUnread, resetRoomUnread, roomsNotificationPreferences]);

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

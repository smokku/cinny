import produce from 'immer';
import { atom, useSetAtom } from 'jotai';
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
import { ReceiptContent, ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts';
import { useCallback, useEffect, useRef } from 'react';
import {
  Membership,
  NotificationType,
  RoomToUnread,
  UnreadInfo,
  Unread,
  StateEvent,
} from '../../../types/matrix/room';
import {
  getAllParents,
  getNotificationType,
  getUnreadInfo,
  getUnreadInfos,
  isNotificationEvent,
  roomHaveUnread,
} from '../../utils/room';
import { getClientSyncDiagnostics } from '../../../client/initMatrix';
import { roomToParentsAtom } from './roomToParents';
import { useStateEventCallback } from '../../hooks/useStateEventCallback';
import { useSyncState } from '../../hooks/useSyncState';
import { useRoomsNotificationPreferencesContext } from '../../hooks/useRoomsNotificationPreferences';

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
  f1?.forEach((item) => {
    if (!f2?.has(item)) {
      fromEqual = false;
    }
  });

  return fromEqual;
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
        // Do not update if unread data has not changes
        // like total & highlight
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

export const useBindRoomToUnreadAtom = (mx: MatrixClient, unreadAtom: typeof roomToUnreadAtom) => {
  const setUnreadAtom = useSetAtom(unreadAtom);
  const roomsNotificationPreferences = useRoomsNotificationPreferencesContext();
  const spaceChildResetTimer = useRef<ReturnType<typeof setTimeout>>();

  const shouldApplyUnreadFixup = useCallback(
    () => getClientSyncDiagnostics(mx).transport === 'sliding',
    [mx]
  );

  const getOptions = useCallback(
    () => ({ applyFixup: shouldApplyUnreadFixup() }),
    [shouldApplyUnreadFixup]
  );

  useEffect(() => {
    setUnreadAtom({
      type: 'RESET',
      unreadInfos: getUnreadInfos(mx, getOptions()),
    });
  }, [mx, setUnreadAtom, getOptions]);

  useSyncState(
    mx,
    useCallback(
      (state, prevState) => {
        if (
          (state === SyncState.Prepared && prevState === null) ||
          (state === SyncState.Syncing && prevState !== SyncState.Syncing)
        ) {
          setUnreadAtom({
            type: 'RESET',
            unreadInfos: getUnreadInfos(mx, getOptions()),
          });
        }
      },
      [mx, setUnreadAtom, getOptions]
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
      if (!room || room.isSpaceRoom() || !isNotificationEvent(mEvent)) return;
      // Backward pagination (loading older history) should never affect unread state
      if (toStartOfTimeline) return;
      const notificationType = getNotificationType(mx, room.roomId);
      if (notificationType === NotificationType.Mute) {
        setUnreadAtom({
          type: 'DELETE',
          roomId: room.roomId,
        });
        return;
      }

      // Handle non-live events (initial sync / sliding sync timeline population)
      const userId = mx.getUserId();
      if (!data.liveEvent && userId && !room.getEventReadUpTo(userId)) {
        const unreadInfo = getUnreadInfo(room, getOptions());
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
        return;
      }

      if (!data.liveEvent) {
        // eslint-disable-next-line no-console
        console.log(
          '[unread] non-live event DROPPED (room has receipt)',
          room.roomId,
          'readUpTo:',
          room.getEventReadUpTo(mx.getSafeUserId()),
          'sender:',
          mEvent.getSender(),
          'type:',
          mEvent.getType()
        );
        return;
      }
      if (mEvent.getSender() === mx.getUserId()) return;
      const unreadInfo = getUnreadInfo(room, getOptions());
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
  }, [mx, setUnreadAtom, getOptions]);

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

      const unreadInfo = getUnreadInfo(room, getOptions());
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
  }, [mx, setUnreadAtom, getOptions]);

  useEffect(() => {
    const handleReceipt = (mEvent: MatrixEvent, room: Room) => {
      const myUserId = mx.getUserId();
      if (!myUserId) return;
      if (room.isSpaceRoom()) return;
      const content = mEvent.getContent<ReceiptContent>();

      const isMyReceipt = Object.keys(content).find((eventId) =>
        (Object.keys(content[eventId]) as ReceiptType[]).find(
          (receiptType) => content[eventId][receiptType][myUserId]
        )
      );
      if (isMyReceipt) {
        const sdkTotal = room.getUnreadNotificationCount(NotificationCountType.Total);
        const sdkHighlight = room.getUnreadNotificationCount(NotificationCountType.Highlight);
        // eslint-disable-next-line no-console
        console.log(
          '[unread] receipt handler for room',
          room.roomId,
          'sdkTotal:',
          sdkTotal,
          'sdkHighlight:',
          sdkHighlight
        );
        // When we just sent our own receipt and SDK counts are zero, trust the receipt
        // and delete unread state. getUnreadInfo's no-receipt fallback can race here
        // because getEventReadUpTo may not have processed the receipt yet.
        if (sdkTotal === 0 && sdkHighlight === 0) {
          setUnreadAtom({ type: 'DELETE', roomId: room.roomId });
          return;
        }
        const unreadInfo = getUnreadInfo(room, getOptions());
        if (unreadInfo.total === 0 && unreadInfo.highlight === 0) {
          setUnreadAtom({ type: 'DELETE', roomId: room.roomId });
          return;
        }
        setUnreadAtom({ type: 'PUT', unreadInfo });
      }
    };
    mx.on(RoomEvent.Receipt, handleReceipt);
    return () => {
      mx.removeListener(RoomEvent.Receipt, handleReceipt);
    };
  }, [mx, setUnreadAtom, getOptions]);

  // Sliding sync pushes server-calculated unread counts
  useEffect(() => {
    const handleUnreadNotifications = (
      _notification: unknown,
      _threadId: string | undefined,
      room: Room
    ) => {
      if (!room || room.isSpaceRoom()) return;
      const notificationType = getNotificationType(mx, room.roomId);
      if (notificationType === NotificationType.Mute) return;
      const unreadInfo = getUnreadInfo(room, getOptions());
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
    (mx as any).on(RoomEvent.UnreadNotifications, handleUnreadNotifications);
    return () => {
      (mx as any).removeListener(RoomEvent.UnreadNotifications, handleUnreadNotifications);
    };
  }, [mx, setUnreadAtom, getOptions]);

  // Seed badge state when a new room is added
  useEffect(() => {
    const handleRoom = (room: Room) => {
      if (room.isSpaceRoom()) return;
      if (room.getMyMembership() !== Membership.Join) return;
      const notificationType = getNotificationType(mx, room.roomId);
      if (notificationType === NotificationType.Mute) return;
      const unreadInfo = getUnreadInfo(room, getOptions());
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
    mx.on(ClientEvent.Room, handleRoom);
    return () => {
      mx.removeListener(ClientEvent.Room, handleRoom);
    };
  }, [mx, setUnreadAtom, getOptions]);

  useEffect(() => {
    setUnreadAtom({
      type: 'RESET',
      unreadInfos: getUnreadInfos(mx, getOptions()),
    });
  }, [mx, setUnreadAtom, roomsNotificationPreferences, getOptions]);

  useEffect(() => {
    const handleMembershipChange = (room: Room, membership: string) => {
      if (membership !== Membership.Join) {
        setUnreadAtom({
          type: 'DELETE',
          roomId: room.roomId,
        });
      }
    };
    mx.on(RoomEvent.MyMembership, handleMembershipChange);
    return () => {
      mx.removeListener(RoomEvent.MyMembership, handleMembershipChange);
    };
  }, [mx, setUnreadAtom]);

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (mEvent.getType() === StateEvent.SpaceChild) {
          // Debounce space child resets to avoid excessive recalculations
          clearTimeout(spaceChildResetTimer.current);
          spaceChildResetTimer.current = setTimeout(() => {
            setUnreadAtom({
              type: 'RESET',
              unreadInfos: getUnreadInfos(mx, getOptions()),
            });
          }, 150);
        }
      },
      [mx, setUnreadAtom, getOptions]
    )
  );

  // Cleanup debounce timer
  useEffect(
    () => () => {
      clearTimeout(spaceChildResetTimer.current);
    },
    []
  );
};

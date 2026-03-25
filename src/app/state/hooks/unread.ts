import { useCallback, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { RoomToThreadUnread, RoomToUnread, ThreadUnread, Unread } from '../../../types/matrix/room';
import {
  roomToThreadUnreadAtom,
  roomToUnreadAtom,
  unreadEqual,
} from '../room/roomToUnread';

const compareUnreadEqual = (u1?: Unread, u2?: Unread): boolean => {
  if (!u1 && !u2) return true;
  if (!u1 || !u2) return false;
  return unreadEqual(u1, u2);
};

const getRoomsUnread = (rooms: string[], roomToUnread: RoomToUnread): Unread | undefined => {
  const unread = rooms.reduce<Unread | undefined>((u, roomId) => {
    const roomUnread = roomToUnread.get(roomId);
    if (!roomUnread) return u;
    const newUnread: Unread = u ?? {
      total: 0,
      highlight: 0,
      from: new Set(),
    };
    newUnread.total += roomUnread.total;
    newUnread.highlight += roomUnread.highlight;
    newUnread.from?.add(roomId);
    return newUnread;
  }, undefined);
  return unread;
};

const getThreadMapUnread = (
  roomId: string,
  threadToUnread: Map<string, ThreadUnread> | undefined
): Unread | undefined => {
  if (!threadToUnread || threadToUnread.size === 0) return undefined;

  let total = 0;
  let highlight = 0;
  threadToUnread.forEach((unread) => {
    total += unread.total;
    highlight += unread.highlight;
  });

  return {
    total,
    highlight,
    from: new Set([roomId]),
  };
};

const getRoomsThreadUnread = (
  rooms: string[],
  roomToThreadUnread: RoomToThreadUnread
): Unread | undefined => {
  const unread = rooms.reduce<Unread | undefined>((u, roomId) => {
    const roomThreads = roomToThreadUnread.get(roomId);
    if (!roomThreads || roomThreads.size === 0) return u;

    const nextUnread: Unread = u ?? {
      total: 0,
      highlight: 0,
      from: new Set(),
    };
    roomThreads.forEach((threadUnread) => {
      nextUnread.total += threadUnread.total;
      nextUnread.highlight += threadUnread.highlight;
    });
    nextUnread.from?.add(roomId);
    return nextUnread;
  }, undefined);

  return unread;
};

const mergeUnread = (a?: Unread, b?: Unread): Unread | undefined => {
  if (!a && !b) return undefined;
  const from = new Set<string>([...(a?.from ?? []), ...(b?.from ?? [])]);
  return {
    total: (a?.total ?? 0) + (b?.total ?? 0),
    highlight: (a?.highlight ?? 0) + (b?.highlight ?? 0),
    from: from.size > 0 ? from : null,
  };
};

export const useRoomsUnread = (
  rooms: string[],
  roomToUnreadAtm: typeof roomToUnreadAtom
): Unread | undefined => {
  const selector = useCallback(
    (roomToUnread: RoomToUnread) => getRoomsUnread(rooms, roomToUnread),
    [rooms]
  );
  return useAtomValue(selectAtom(roomToUnreadAtm, selector, compareUnreadEqual));
};

export const useRoomUnread = (
  roomId: string,
  roomToUnreadAtm: typeof roomToUnreadAtom
): Unread | undefined => {
  const selector = useCallback((roomToUnread: RoomToUnread) => roomToUnread.get(roomId), [roomId]);
  return useAtomValue(selectAtom(roomToUnreadAtm, selector, compareUnreadEqual));
};

export const useRoomsThreadUnread = (rooms: string[]): Unread | undefined => {
  const selector = useCallback(
    (roomToThreadUnread: RoomToThreadUnread) => getRoomsThreadUnread(rooms, roomToThreadUnread),
    [rooms]
  );
  return useAtomValue(selectAtom(roomToThreadUnreadAtom, selector, compareUnreadEqual));
};

export const useRoomThreadUnread = (roomId: string): Unread | undefined => {
  const selector = useCallback(
    (roomToThreadUnread: RoomToThreadUnread) =>
      getThreadMapUnread(roomId, roomToThreadUnread.get(roomId)),
    [roomId]
  );
  return useAtomValue(selectAtom(roomToThreadUnreadAtom, selector, compareUnreadEqual));
};

export const useRoomsCombinedUnread = (rooms: string[]): Unread | undefined => {
  const roomUnread = useRoomsUnread(rooms, roomToUnreadAtom);
  const threadUnread = useRoomsThreadUnread(rooms);

  return useMemo(() => mergeUnread(roomUnread, threadUnread), [roomUnread, threadUnread]);
};

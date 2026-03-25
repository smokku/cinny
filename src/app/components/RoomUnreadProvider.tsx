import { ReactElement, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { Unread } from '../../types/matrix/room';
import { useRoomUnread, useRoomsCombinedUnread } from '../state/hooks/unread';
import { roomToThreadUnreadAtom, roomToUnreadAtom } from '../state/room/roomToUnread';
import { roomToParentsAtom } from '../state/room/roomToParents';
import { getAllParents } from '../utils/room';

function addUnread(a?: Unread, b?: Unread): Unread | undefined {
  if (!a && !b) return undefined;
  const from = new Set<string>([...(a?.from ?? []), ...(b?.from ?? [])]);
  return {
    total: (a?.total ?? 0) + (b?.total ?? 0),
    highlight: (a?.highlight ?? 0) + (b?.highlight ?? 0),
    from: from.size > 0 ? from : null,
  };
}

type RoomUnreadProviderProps = {
  roomId: string;
  children: (unread?: Unread) => ReactElement;
};
export function RoomUnreadProvider({ roomId, children }: RoomUnreadProviderProps) {
  const roomUnread = useRoomUnread(roomId, roomToUnreadAtom);
  const threadUnreadMap = useAtomValue(roomToThreadUnreadAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);

  const threadUnread = useMemo(() => {
    let total = 0;
    let highlight = 0;
    const from = new Set<string>();
    threadUnreadMap.forEach((roomThreads, childRoomId) => {
      if (roomThreads.size === 0) return;
      const parents = getAllParents(roomToParents, childRoomId);
      if (parents.has(roomId)) {
        roomThreads.forEach((threadUnreadState) => {
          total += threadUnreadState.total;
          highlight += threadUnreadState.highlight;
        });
        from.add(childRoomId);
      }
    });

    if (from.size === 0) return undefined;

    return { total, highlight, from };
  }, [roomId, threadUnreadMap, roomToParents]);

  const combined = addUnread(roomUnread, threadUnread);
  return children(combined);
}

type RoomsUnreadProviderProps = {
  rooms: string[];
  children: (unread?: Unread) => ReactElement;
};
export function RoomsUnreadProvider({ rooms, children }: RoomsUnreadProviderProps) {
  const unread = useRoomsCombinedUnread(rooms);

  return children(unread);
}

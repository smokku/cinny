import { useCallback, useMemo } from 'react';
import { Room } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { RoomToThreadUnread } from '../../types/matrix/room';
import { roomThreadUnreadEqual, roomToThreadUnreadAtom } from '../state/room/roomToUnread';

export type UnreadThreadInfo = {
  threadId: string;
  body: string;
  count: number;
  highlight: boolean;
};

export function useRoomUnreadThreads(room: Room): UnreadThreadInfo[] {
  const selector = useCallback(
    (roomToThreadUnread: RoomToThreadUnread) => roomToThreadUnread.get(room.roomId),
    [room.roomId]
  );
  const roomThreads = useAtomValue(selectAtom(roomToThreadUnreadAtom, selector, roomThreadUnreadEqual));

  return useMemo(
    () =>
      Array.from(roomThreads?.entries() ?? [])
        .sort(([, a], [, b]) => b.order - a.order)
        .map(([threadId, unread]) => {
          const body = room.findEventById(threadId)?.getContent()?.body;
          return {
            threadId,
            body: typeof body === 'string' ? body.slice(0, 80) : 'Thread',
            count: unread.total,
            highlight: unread.highlight > 0,
          };
        }),
    [room, roomThreads]
  );
}

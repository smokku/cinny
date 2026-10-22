import { useCallback, useMemo } from 'react';
import { Room } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { RoomToThreadUnread } from '../../types/matrix/room';
import { roomThreadUnreadEqual, roomToThreadUnreadAtom } from '../state/room/roomToUnread';
import { GALLERY_MSGTYPE, IGalleryContent } from '../../types/matrix/common';
import { getGalleryPreview } from '../utils/gallery';

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
  const roomThreads = useAtomValue(
    selectAtom(roomToThreadUnreadAtom, selector, roomThreadUnreadEqual)
  );

  return useMemo(
    () =>
      Array.from(roomThreads?.entries() ?? [])
        .sort(([, a], [, b]) => b.order - a.order)
        .map(([threadId, unread]) => {
          const content = room.findEventById(threadId)?.getContent();
          const body =
            content?.msgtype === GALLERY_MSGTYPE
              ? getGalleryPreview(content as IGalleryContent)
              : content?.body;
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

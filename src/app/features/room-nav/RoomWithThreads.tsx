import React from 'react';
import { Room } from 'matrix-js-sdk';
import { RoomNavItem } from './RoomNavItem';
import { ThreadNavItem, ThreadsSummaryNavItem } from './ThreadNavItem';
import { useRoomUnreadThreads } from '../../hooks/useRoomUnreadThreads';
import { RoomNotificationMode } from '../../hooks/useRoomsNotificationPreferences';

const MAX_VISIBLE_THREADS = 3;

type RoomWithThreadsProps = {
  room: Room;
  selected: boolean;
  linkPath: string;
  notificationMode?: RoomNotificationMode;
  showAvatar?: boolean;
  direct?: boolean;
};

export function RoomWithThreads(props: RoomWithThreadsProps) {
  const { room } = props;
  const unreadThreads = useRoomUnreadThreads(room);

  return (
    <>
      <RoomNavItem {...props} />
      {unreadThreads.length > 0 &&
        (unreadThreads.length <= MAX_VISIBLE_THREADS ? (
          unreadThreads.map((t) => (
            <ThreadNavItem
              key={t.threadId}
              roomId={room.roomId}
              threadId={t.threadId}
              body={t.body}
              count={t.count}
              highlight={t.highlight}
            />
          ))
        ) : (
          <ThreadsSummaryNavItem
            roomId={room.roomId}
            threadCount={unreadThreads.length}
            totalCount={unreadThreads.reduce((sum, t) => sum + t.count, 0)}
            highlight={unreadThreads.some((t) => t.highlight)}
          />
        ))}
    </>
  );
}

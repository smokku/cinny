import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import { useRoomNickname } from '../../../hooks/useRoomMeta';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { getDirectRoomAvatarUrl } from '../../../utils/room';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { nameInitials } from '../../../utils/common';
import { getDirectRoomPath } from '../../pathUtils';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../../components/sidebar';
import { RoomAvatar } from '../../../components/room-avatar';
import { UnreadBadge } from '../../../components/unread-badge';
import { useSidebarDirectRoomIds } from './useSidebarDirectRoomIds';

type DMItemProps = {
  room: Room;
  selected: boolean;
};

function DMItem({ room, selected }: DMItemProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const navigate = useNavigate();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const roomName = useRoomNickname(room, true);

  const unread = roomToUnread.get(room.roomId);

  const handleClick = () => {
    navigate(getDirectRoomPath(getCanonicalAliasOrRoomId(mx, room.roomId)));
  };

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={roomName}>
        {(triggerRef) => (
          <SidebarAvatar as="button" ref={triggerRef} outlined onClick={handleClick}>
            <Avatar size="400" radii="400">
              <RoomAvatar
                roomId={room.roomId}
                src={getDirectRoomAvatarUrl(mx, room, 96, useAuthentication)}
                alt={roomName}
                renderFallback={() => (
                  <Text as="span" size="H4">
                    {nameInitials(roomName)}
                  </Text>
                )}
              />
            </Avatar>
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {unread && (unread.total > 0 || unread.highlight > 0) && (
        <SidebarItemBadge hasCount={unread.total > 0}>
          <UnreadBadge highlight={unread.highlight > 0} count={unread.total} />
        </SidebarItemBadge>
      )}
    </SidebarItem>
  );
}

export function DirectDMsList() {
  const mx = useMatrixClient();
  const selectedRoomId = useSelectedRoom();
  const sidebarRoomIds = useSidebarDirectRoomIds();

  const rooms = useMemo(
    () =>
      sidebarRoomIds
        .map((roomId) => mx.getRoom(roomId))
        .filter((room): room is Room => room !== null),
    [sidebarRoomIds, mx]
  );

  if (rooms.length === 0) return null;

  return (
    <>
      {rooms.map((room) => (
        <DMItem key={room.roomId} room={room} selected={selectedRoomId === room.roomId} />
      ))}
    </>
  );
}

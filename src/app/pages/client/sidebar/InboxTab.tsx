import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, Icons } from 'folds';
import { useAtomValue } from 'jotai';
import { NotificationCountType } from 'matrix-js-sdk';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../../components/sidebar';
import { allInvitesAtom } from '../../../state/room-list/inviteList';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import {
  getInboxInvitesPath,
  getInboxNotificationsPath,
  getInboxPath,
  joinPathComponent,
} from '../../pathUtils';
import { useInboxSelected } from '../../../hooks/router/useInbox';
import { UnreadBadge } from '../../../components/unread-badge';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { useNavToActivePathAtom } from '../../../state/hooks/navToActivePath';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useMatrixClient } from '../../../hooks/useMatrixClient';

export function InboxTab() {
  const screenSize = useScreenSizeContext();
  const navigate = useNavigate();
  const navToActivePath = useAtomValue(useNavToActivePathAtom());
  const inboxSelected = useInboxSelected();
  const allInvites = useAtomValue(allInvitesAtom);
  const inviteCount = allInvites.length;
  const allRooms = useAtomValue(allRoomsAtom);
  const mx = useMatrixClient();

  // Inbox is the "server notifications" surface.  We must NOT use the
  // aggregated `roomToUnreadAtom` entries because `putUnreadInfo` adds the
  // child room's deltas onto every parent space's entry — summing across
  // `allRooms` would then count every notification twice (once in the
  // leaf, once in each parent space).  Instead we ask the SDK directly
  // for each room's own server counts.  This naturally includes spaces
  // that happen to host their own messages (a space is just a room) and
  // never re-counts a leaf room's notifications under its parents.
  //
  // The atom is consumed only as a re-render trigger: it ticks whenever
  // notifications change, which is when we want to recompute.
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const serverUnread = useMemo(() => {
    let total = 0;
    let highlight = 0;
    allRooms.forEach((roomId) => {
      const room = mx.getRoom(roomId);
      if (!room) return;
      total += room.getRoomUnreadNotificationCount(NotificationCountType.Total);
      highlight += room.getRoomUnreadNotificationCount(NotificationCountType.Highlight);
    });
    return { total, highlight };
    // `roomToUnread` is intentionally a dep so we recompute on every
    // notification change without subscribing to a derived selector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRooms, mx, roomToUnread]);

  const highlightCount = inviteCount + serverUnread.highlight;

  const handleInboxClick = () => {
    if (screenSize === ScreenSize.Mobile) {
      navigate(getInboxPath());
      return;
    }
    const activePath = navToActivePath.get('inbox');
    if (activePath) {
      navigate(joinPathComponent(activePath));
      return;
    }

    const path = inviteCount > 0 ? getInboxInvitesPath() : getInboxNotificationsPath();
    navigate(path);
  };

  return (
    <SidebarItem active={inboxSelected}>
      <SidebarItemTooltip tooltip="Inbox">
        {(triggerRef) => (
          <SidebarAvatar as="button" ref={triggerRef} outlined onClick={handleInboxClick}>
            <Icon src={Icons.Inbox} filled={inboxSelected} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {highlightCount > 0 && (
        <SidebarItemBadge hasCount>
          <UnreadBadge highlight count={highlightCount} />
        </SidebarItemBadge>
      )}
    </SidebarItem>
  );
}

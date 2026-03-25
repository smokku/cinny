import React from 'react';
import { Box, Icon, Icons, Text, config, toRem } from 'folds';
import { useSetAtom } from 'jotai';
import { NavItem, NavButton, NavItemContent } from '../../components/nav';
import { UnreadBadge, UnreadBadgeCenter } from '../../components/unread-badge';
import { roomIdToOpenThreadAtomFamily } from '../../state/room/roomToOpenThread';
import { roomIdToThreadBrowserAtomFamily } from '../../state/room/roomToThreadBrowser';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';

type ThreadNavItemProps = {
  roomId: string;
  threadId: string;
  body: string;
  count: number;
  highlight: boolean;
};

export function ThreadNavItem({ roomId, threadId, body, count, highlight }: ThreadNavItemProps) {
  const { navigateRoom } = useRoomNavigate();
  const setOpenThread = useSetAtom(roomIdToOpenThreadAtomFamily(roomId));

  const handleClick = () => {
    setOpenThread(threadId);
    navigateRoom(roomId, threadId);
  };

  return (
    <NavItem variant="Background" radii="400" highlight={highlight}>
      <NavButton onClick={handleClick}>
        <NavItemContent>
          <Box
            as="span"
            grow="Yes"
            alignItems="Center"
            gap="200"
            style={{ paddingLeft: config.space.S400, minHeight: toRem(24) }}
          >
            <Icon
              size="50"
              src={Icons.Thread}
              style={{ opacity: config.opacity.P300, flexShrink: 0 }}
            />
            <Box as="span" grow="Yes" style={{ minWidth: 0 }}>
              <Text as="span" size="T200" priority="300" truncate>
                {body || 'Thread'}
              </Text>
            </Box>
            <UnreadBadgeCenter>
              <UnreadBadge highlight={highlight} count={count} />
            </UnreadBadgeCenter>
          </Box>
        </NavItemContent>
      </NavButton>
    </NavItem>
  );
}

type ThreadsSummaryNavItemProps = {
  roomId: string;
  threadCount: number;
  totalCount: number;
  highlight: boolean;
};

export function ThreadsSummaryNavItem({
  roomId,
  threadCount,
  totalCount,
  highlight,
}: ThreadsSummaryNavItemProps) {
  const { navigateRoom } = useRoomNavigate();
  const setThreadBrowserOpen = useSetAtom(roomIdToThreadBrowserAtomFamily(roomId));
  const setOpenThread = useSetAtom(roomIdToOpenThreadAtomFamily(roomId));

  const handleClick = () => {
    setOpenThread(undefined);
    setThreadBrowserOpen(true);
    navigateRoom(roomId);
  };

  return (
    <NavItem variant="Background" radii="400" highlight>
      <NavButton onClick={handleClick}>
        <NavItemContent>
          <Box
            as="span"
            grow="Yes"
            alignItems="Center"
            gap="200"
            style={{ paddingLeft: config.space.S400, minHeight: toRem(24) }}
          >
            <Icon
              size="50"
              src={Icons.Thread}
              style={{ opacity: config.opacity.P300, flexShrink: 0 }}
            />
            <Box as="span" grow="Yes" style={{ minWidth: 0 }}>
              <Text as="span" size="T200" priority="300" truncate>
                {threadCount} unread threads
              </Text>
            </Box>
            <UnreadBadgeCenter>
              <UnreadBadge highlight={highlight} count={totalCount} />
            </UnreadBadgeCenter>
          </Box>
        </NavItemContent>
      </NavButton>
    </NavItem>
  );
}

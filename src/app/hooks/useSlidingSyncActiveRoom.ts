import { useEffect } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useMatrixClient } from './useMatrixClient';
import { getSlidingSyncManager } from '../../client/initMatrix';
import { useResolvedRoomIdOrAlias } from './router/useResolvedRoomId';
import { useSpaces } from '../state/hooks/roomList';
import { allRoomsAtom } from '../state/room-list/roomList';
import {
  DIRECT_ROOM_FORUM_PATH,
  DIRECT_ROOM_PATH,
  HOME_ROOM_FORUM_PATH,
  HOME_ROOM_PATH,
  SPACE_LOBBY_PATH,
  SPACE_PATH,
  SPACE_ROOM_FORUM_PATH,
  SPACE_ROOM_PATH,
  SPACE_SEARCH_PATH,
} from '../pages/paths';
import { isRoomAlias, isRoomId } from '../utils/matrix';

type RouteRoomRefs = {
  roomIdOrAlias?: string;
  spaceIdOrAlias?: string;
};

const decodeRoomRef = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const decoded = decodeURIComponent(value);
  return isRoomId(decoded) || isRoomAlias(decoded) ? decoded : undefined;
};

const getRouteRoomRefs = (pathname: string): RouteRoomRefs => {
  const homeRoomMatch =
    matchPath(HOME_ROOM_FORUM_PATH, pathname) ?? matchPath(HOME_ROOM_PATH, pathname);
  const directRoomMatch =
    matchPath(DIRECT_ROOM_FORUM_PATH, pathname) ?? matchPath(DIRECT_ROOM_PATH, pathname);
  const nonSpaceRoomMatch = homeRoomMatch ?? directRoomMatch;
  if (nonSpaceRoomMatch) {
    return { roomIdOrAlias: decodeRoomRef(nonSpaceRoomMatch.params.roomIdOrAlias) };
  }

  const spaceRoomMatch =
    matchPath(SPACE_ROOM_FORUM_PATH, pathname) ?? matchPath(SPACE_ROOM_PATH, pathname);
  if (spaceRoomMatch) {
    return {
      roomIdOrAlias: decodeRoomRef(spaceRoomMatch.params.roomIdOrAlias),
      spaceIdOrAlias: decodeRoomRef(spaceRoomMatch.params.spaceIdOrAlias),
    };
  }

  const spaceMatch =
    matchPath(SPACE_LOBBY_PATH, pathname) ??
    matchPath(SPACE_SEARCH_PATH, pathname) ??
    matchPath(SPACE_PATH, pathname);
  return { spaceIdOrAlias: decodeRoomRef(spaceMatch?.params.spaceIdOrAlias) };
};

/**
 * Subscribes the rooms on screen with full room state and a deeper timeline.
 * The room lists only carry what the sidebar needs.
 */
const useSlidingSyncRouteRooms = (): void => {
  const mx = useMatrixClient();
  const manager = getSlidingSyncManager(mx);
  const { pathname } = useLocation();
  const { roomIdOrAlias, spaceIdOrAlias } = getRouteRoomRefs(pathname);
  const { roomId, resolving: resolvingRoom } = useResolvedRoomIdOrAlias(roomIdOrAlias);
  const { roomId: spaceId, resolving: resolvingSpace } = useResolvedRoomIdOrAlias(spaceIdOrAlias);

  useEffect(() => {
    if (!manager || resolvingRoom || resolvingSpace) return;

    const activeRoomIds = [spaceId, roomId].filter((id): id is string => !!id);
    manager.setActiveRoomSubscriptions(new Set(activeRoomIds));
  }, [manager, resolvingRoom, resolvingSpace, roomId, spaceId]);

  useEffect(() => {
    if (!manager) return undefined;
    return () => manager.setActiveRoomSubscriptions([]);
  }, [manager]);
};

const useSlidingSyncSpaceSubscriptions = (): void => {
  const mx = useMatrixClient();
  const manager = getSlidingSyncManager(mx);
  const spaces = useSpaces(mx, allRoomsAtom);

  useEffect(() => {
    manager?.setSpaceSubscriptions(spaces);
  }, [manager, spaces]);
};

export const useSlidingSyncActiveRoom = (): void => {
  useSlidingSyncRouteRooms();
  useSlidingSyncSpaceSubscriptions();
};

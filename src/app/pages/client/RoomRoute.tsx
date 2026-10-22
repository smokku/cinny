import React, { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ForumView } from '../../features/forum';
import { Room } from '../../features/room';
import { useRoom } from '../../hooks/useRoom';
import {
  getDirectForumPath,
  getDirectRoomPath,
  getHomeForumPath,
  getHomeRoomPath,
  getSpaceForumPath,
  getSpaceRoomPath,
} from '../pathUtils';
import { ROOM_TIMELINE_SEARCH_PARAM } from '../paths';
import { RoomType } from '../../../types/matrix/room';

type RoomRouteSection = 'home' | 'direct' | 'space';

type RoomRouteProps = {
  section: RoomRouteSection;
  forum: boolean;
};

/**
 * Renders the forum view for forum rooms and the timeline for everything else,
 * redirecting links that point at the wrong one (keeping the event id).
 */
export function RoomRoute({ section, forum }: RoomRouteProps) {
  const room = useRoom();
  const navigate = useNavigate();
  const { roomIdOrAlias, spaceIdOrAlias, eventId } = useParams();
  const [searchParams] = useSearchParams();
  // Lets the developer tools open a forum room's timeline without being redirected back.
  const timelineRequested = !forum && searchParams.get(ROOM_TIMELINE_SEARCH_PARAM) === 'true';
  const isForum = room.getType() === RoomType.Forum && !timelineRequested;

  useEffect(() => {
    if (isForum === forum || !roomIdOrAlias) return;

    let path: string;
    if (section === 'space') {
      if (!spaceIdOrAlias) return;
      path = isForum
        ? getSpaceForumPath(spaceIdOrAlias, roomIdOrAlias, eventId)
        : getSpaceRoomPath(spaceIdOrAlias, roomIdOrAlias, eventId);
    } else if (section === 'direct') {
      path = isForum
        ? getDirectForumPath(roomIdOrAlias, eventId)
        : getDirectRoomPath(roomIdOrAlias, eventId);
    } else {
      path = isForum
        ? getHomeForumPath(roomIdOrAlias, eventId)
        : getHomeRoomPath(roomIdOrAlias, eventId);
    }

    navigate(path, { replace: true });
  }, [eventId, forum, isForum, navigate, roomIdOrAlias, section, spaceIdOrAlias]);

  if (isForum !== forum) return null;
  return forum ? <ForumView /> : <Room />;
}

import { useEffect, useState } from 'react';
import { Room } from 'matrix-js-sdk';
import { hydrateRoomMember } from '../../client/roomMemberHydration';
import { useMatrixClient } from './useMatrixClient';

/**
 * Under sliding sync, m.room.member events only arrive for senders in the
 * lazy-loaded sync window. Fetch the member on demand and bump local state so
 * the caller re-reads room member state (avatar, display name) once hydrated.
 *
 * With a profile display name that differs from the member's, the member event
 * is refreshed too, as it may be stale.
 */
export const useRoomMemberHydration = (
  room: Room,
  userId: string,
  hasTimelineMember?: boolean,
  profileDisplayName?: string
): number => {
  const mx = useMatrixClient();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!userId.startsWith('@')) return undefined;

    const member = room.getMember(userId);
    const missing = !member && !hasTimelineMember;
    const stale = !!member && !!profileDisplayName && profileDisplayName !== member.rawDisplayName;
    if (!missing && !stale) return undefined;

    let disposed = false;
    hydrateRoomMember(mx, room.roomId, userId, stale).then(() => {
      if (!disposed && room.getMember(userId)) setVersion((v) => v + 1);
    });
    return () => {
      disposed = true;
    };
  }, [mx, room, userId, hasTimelineMember, profileDisplayName]);

  return version;
};

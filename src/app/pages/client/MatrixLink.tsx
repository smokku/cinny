import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { parseMatrixUri } from '../../plugins/matrix-uri';
import { getCanonicalAliasRoomId, isRoomAlias } from '../../utils/matrix';
import { getMatrixLinkSearchParams } from '../pathSearchParam';
import {
  encodeSearchParamValueArray,
  getAppPathFromHref,
  getDirectCreatePath,
  getHomePath,
  getHomeRoomPath,
  getMatrixLinkPath,
  getOriginBaseUrl,
  withSearchParam,
} from '../pathUtils';
import { _RoomSearchParams, DirectCreateSearchParams } from '../paths';
import { Membership } from '../../../types/matrix/room';

/**
 * Target of the `matrix:` protocol handler registered in the web app manifest.
 * Resolves the URI passed in `?uri=` and replaces itself with the matching app route.
 */
export function MatrixLink() {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const { navigateRoom, navigateSpace } = useRoomNavigate();
  const [searchParams] = useSearchParams();
  const { uri } = getMatrixLinkSearchParams(searchParams);

  useEffect(() => {
    const link = uri ? parseMatrixUri(uri) : undefined;
    if (!link) {
      navigate(getHomePath(), { replace: true });
      return;
    }

    if ('userId' in link) {
      navigate(
        withSearchParam<DirectCreateSearchParams>(getDirectCreatePath(), { userId: link.userId }),
        { replace: true }
      );
      return;
    }

    const { roomIdOrAlias, eventId, viaServers } = link;
    const roomId = isRoomAlias(roomIdOrAlias)
      ? getCanonicalAliasRoomId(mx, roomIdOrAlias)
      : roomIdOrAlias;
    const room = roomId ? mx.getRoom(roomId) : null;

    if (room?.getMyMembership() === Membership.Join) {
      if (room.isSpaceRoom()) navigateSpace(room.roomId, { replace: true });
      else navigateRoom(room.roomId, eventId, { replace: true });
      return;
    }

    // not joined yet, let the room route offer to join
    const path = getHomeRoomPath(roomIdOrAlias, eventId);
    navigate(
      viaServers
        ? withSearchParam<_RoomSearchParams>(path, {
            viaServers: encodeSearchParamValueArray(viaServers),
          })
        : path,
      { replace: true }
    );
  }, [mx, navigate, navigateRoom, navigateSpace, uri]);

  return null;
}

// The launch that opened this document has already navigated to its target URL.
const documentHref = window.location.href;
let documentLaunchSeen = false;

/**
 * With `launch_handler.client_mode` set to `focus-existing`, links opened through the protocol
 * handler focus the running app window instead of loading a new one, and the target URL is
 * delivered here instead.
 */
export function MatrixLinkLaunchConsumer() {
  const navigate = useNavigate();

  useEffect(() => {
    window.launchQueue?.setConsumer(({ targetURL }) => {
      if (!targetURL) return;
      if (!documentLaunchSeen) {
        documentLaunchSeen = true;
        if (targetURL === documentHref) return;
      }

      const path = getAppPathFromHref(getOriginBaseUrl(), targetURL);
      if (path.startsWith(getMatrixLinkPath())) navigate(path);
    });
  }, [navigate]);

  return null;
}

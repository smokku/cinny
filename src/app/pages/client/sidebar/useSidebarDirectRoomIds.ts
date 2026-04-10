import { useMemo, useState, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { SyncState } from 'matrix-js-sdk';
import { useDirects } from '../../../state/hooks/roomList';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { mDirectAtom } from '../../../state/mDirectList';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { factoryRoomIdByActivity } from '../../../utils/sort';
import { useSyncState } from '../../../hooks/useSyncState';

export const MAX_SIDEBAR_DMS = 3;

export const useSidebarDirectRoomIds = (): string[] => {
  const mx = useMatrixClient();
  const mDirects = useAtomValue(mDirectAtom);
  const directs = useDirects(mx, allRoomsAtom, mDirects);
  const roomToUnread = useAtomValue(roomToUnreadAtom);

  const [syncReady, setSyncReady] = useState(false);

  useSyncState(
    mx,
    useCallback((state) => {
      if (state === SyncState.Syncing || state === SyncState.Catchup) {
        setSyncReady(true);
      }
    }, [])
  );

  return useMemo(() => {
    if (!syncReady) return [];

    const withUnread = directs.filter((roomId) => {
      const unread = roomToUnread.get(roomId);
      return unread && (unread.total > 0 || unread.highlight > 0);
    });

    return withUnread.sort(factoryRoomIdByActivity(mx)).slice(0, MAX_SIDEBAR_DMS);
  }, [directs, mx, roomToUnread, syncReady]);
};

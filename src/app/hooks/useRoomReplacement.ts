import { useCallback } from 'react';
import { Room } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import { AsyncState, AsyncStatus, useAsyncCallback } from './useAsyncCallback';
import { isRoomId } from '../utils/matrix';
import { getViaServers } from '../plugins/via-servers';

const NOOP = async () => undefined as never;

export function useRoomReplacement(roomId: string, replacementRoomId?: string) {
  const mx = useMatrixClient();
  const validReplacementRoomId =
    replacementRoomId && isRoomId(replacementRoomId) && replacementRoomId.includes(':')
      ? replacementRoomId
      : undefined;

  const [joinState, handleJoin] = useAsyncCallback(
    useCallback(() => {
      if (!validReplacementRoomId) return NOOP();
      const currentRoom = mx.getRoom(roomId);
      const via = currentRoom ? getViaServers(currentRoom) : [];
      return mx.joinRoom(validReplacementRoomId, {
        viaServers: via,
      });
    }, [mx, roomId, validReplacementRoomId])
  );

  const replacementRoom: Room | null | undefined = validReplacementRoomId
    ? mx.getRoom(validReplacementRoomId)
    : undefined;

  return { validReplacementRoomId, replacementRoom, joinState, handleJoin };
}

export function useReplacementOpen(
  replacementRoom: Room | null | undefined,
  joinState: AsyncState<Room>,
  navigate: (roomId: string) => void
) {
  return useCallback(() => {
    if (replacementRoom) {
      navigate(replacementRoom.roomId);
    } else if (joinState.status === AsyncStatus.Success) {
      navigate(joinState.data.roomId);
    }
  }, [replacementRoom, joinState, navigate]);
}

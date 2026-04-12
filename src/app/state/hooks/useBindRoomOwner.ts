import { useEffect, useRef } from 'react';
import { MatrixClient, ClientEvent, Room } from 'matrix-js-sdk';
import { useAtomValue, useSetAtom } from 'jotai';
import { roomOwnerByRoomIdAtom } from '../sessions';

/**
 * Keeps roomOwnerByRoomIdAtom in sync for a given client.
 * Each client registers its own rooms; the map is a simple merge
 * (last-write-wins, which is fine because room IDs are unique per account).
 */
export const useBindRoomOwnerAtom = (mx: MatrixClient | undefined) => {
  const currentOwnerMap = useAtomValue(roomOwnerByRoomIdAtom);
  const setRoomOwner = useSetAtom(roomOwnerByRoomIdAtom);
  const ownerMapRef = useRef(currentOwnerMap);
  ownerMapRef.current = currentOwnerMap;

  useEffect(() => {
    if (!mx) return undefined;

    const userId = mx.getSafeUserId();

    const syncOwnership = () => {
      const rooms = mx.getRooms();
      const next = { ...ownerMapRef.current };
      // Remove stale entries for this user
      for (const [roomId, owner] of Object.entries(next)) {
        if (owner === userId) {
          delete next[roomId];
        }
      }
      // Re-add current rooms
      for (const room of rooms) {
        next[room.roomId] = userId;
      }
      setRoomOwner(next);
    };

    // Initial sync
    syncOwnership();

    const onCreate = (_room: Room) => syncOwnership();
    const onDelete = (_roomId: string) => syncOwnership();

    mx.on(ClientEvent.Room, onCreate);
    mx.on('deleteRoom' as any, onDelete);

    return () => {
      mx.removeListener(ClientEvent.Room, onCreate);
      mx.removeListener('deleteRoom' as any, onDelete);
    };
  }, [mx, setRoomOwner]);
};

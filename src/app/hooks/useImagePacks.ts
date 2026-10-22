import { Room } from 'matrix-js-sdk';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { StateEvent } from '../../types/matrix/room';
import {
  getGlobalImagePackRoomIds,
  getGlobalImagePacks,
  getRoomImagePack,
  getRoomImagePacks,
  getUserImagePack,
  ImagePack,
  ImageUsage,
} from '../plugins/custom-emoji';
import { useMatrixClient } from './useMatrixClient';
import { useAccountDataCallback } from './useAccountDataCallback';
import { useStateEventCallback } from './useStateEventCallback';
import { getSlidingSyncManager } from '../../client/initMatrix';

export const useUserImagePack = (): ImagePack | undefined => {
  const mx = useMatrixClient();
  const [userPack, setUserPack] = useState(() => getUserImagePack(mx));

  useAccountDataCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (mEvent.getType() === AccountDataEvent.PoniesUserEmotes) {
          setUserPack(getUserImagePack(mx));
        }
      },
      [mx]
    )
  );

  return userPack;
};

export const useGlobalImagePacks = (): ImagePack[] => {
  const mx = useMatrixClient();
  const [globalPacks, setGlobalPacks] = useState(() => getGlobalImagePacks(mx));
  const [packRoomIds, setPackRoomIds] = useState(() => getGlobalImagePackRoomIds(mx));

  // With sliding sync a pack room can arrive before the SDK stores it, so its
  // state events never reach the client-level listener below.
  useEffect(() => {
    const manager = getSlidingSyncManager(mx);
    if (!manager) return undefined;

    const refresh = () => setGlobalPacks(getGlobalImagePacks(mx));
    const listeners = packRoomIds.map((roomId) => manager.onRoomData(roomId, refresh));
    return () => listeners.forEach((unsubscribe) => unsubscribe());
  }, [mx, packRoomIds]);

  useAccountDataCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (mEvent.getType() === AccountDataEvent.PoniesEmoteRooms) {
          setPackRoomIds(getGlobalImagePackRoomIds(mx));
          setGlobalPacks(getGlobalImagePacks(mx));
        }
      },
      [mx]
    )
  );

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        const eventType = mEvent.getType();
        const roomId = mEvent.getRoomId();
        if (eventType === StateEvent.PoniesRoomEmotes && roomId && packRoomIds.includes(roomId)) {
          setGlobalPacks(getGlobalImagePacks(mx));
        }
      },
      [mx, packRoomIds]
    )
  );

  return globalPacks;
};

export const useRoomImagePack = (room: Room, stateKey: string): ImagePack | undefined => {
  const mx = useMatrixClient();
  const [roomPack, setRoomPack] = useState(() => getRoomImagePack(room, stateKey));

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (
          mEvent.getRoomId() === room.roomId &&
          mEvent.getType() === StateEvent.PoniesRoomEmotes &&
          mEvent.getStateKey() === stateKey
        ) {
          setRoomPack(getRoomImagePack(room, stateKey));
        }
      },
      [room, stateKey]
    )
  );

  return roomPack;
};

export const useRoomImagePacks = (room: Room): ImagePack[] => {
  const mx = useMatrixClient();
  const [roomPacks, setRoomPacks] = useState(() => getRoomImagePacks(room));

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (
          mEvent.getRoomId() === room.roomId &&
          mEvent.getType() === StateEvent.PoniesRoomEmotes
        ) {
          setRoomPacks(getRoomImagePacks(room));
        }
      },
      [room]
    )
  );

  return roomPacks;
};

export const useRoomsImagePacks = (rooms: Room[]) => {
  const mx = useMatrixClient();
  const [roomPacks, setRoomPacks] = useState(() => rooms.flatMap(getRoomImagePacks));

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (
          rooms.find((room) => room.roomId === mEvent.getRoomId()) &&
          mEvent.getType() === StateEvent.PoniesRoomEmotes
        ) {
          setRoomPacks(rooms.flatMap(getRoomImagePacks));
        }
      },
      [rooms]
    )
  );

  return roomPacks;
};

export const useRelevantImagePacks = (usage: ImageUsage, rooms: Room[]): ImagePack[] => {
  const userPack = useUserImagePack();
  const globalPacks = useGlobalImagePacks();
  const roomsPacks = useRoomsImagePacks(rooms);

  const relevantPacks = useMemo(() => {
    const packs = userPack ? [userPack] : [];
    const globalPackIds = new Set(globalPacks.map((pack) => pack.id));

    const relPacks = packs.concat(
      globalPacks,
      roomsPacks.filter((pack) => !globalPackIds.has(pack.id))
    );

    return relPacks.filter((pack) => pack.getImages(usage).length > 0);
  }, [userPack, globalPacks, roomsPacks, usage]);

  return relevantPacks;
};

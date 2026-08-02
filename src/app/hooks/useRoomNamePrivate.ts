import { useCallback, useEffect, useState } from 'react';
import { Room, RoomEvent, RoomEventHandlerMap } from 'matrix-js-sdk';
import { AccountDataEvent, RoomNamePrivateContent } from '../../types/matrix/accountData';
import { useMatrixClient } from './useMatrixClient';

/**
 * MSC4431 — personal room name override.
 *
 * Reads the per-user `m.room.name.private` room account data. Returns the
 * overridden name when set, or `undefined` when there is no override.
 *
 * Per the MSC, an empty object (`{}`) means the override was removed (→
 * `undefined`), while `{ name: "" }` is a valid blank name and is returned as
 * an empty string. Hence we honor any value where `name` is a string.
 */
export const useRoomNamePrivate = (room: Room): string | undefined => {
  const readName = useCallback((): string | undefined => {
    const content = room
      .getAccountData(AccountDataEvent.RoomNamePrivate)
      ?.getContent<RoomNamePrivateContent>();
    return typeof content?.name === 'string' ? content.name : undefined;
  }, [room]);

  const [name, setName] = useState<string | undefined>(readName);

  useEffect(() => {
    setName(readName());

    const handleAccountData: RoomEventHandlerMap[RoomEvent.AccountData] = (mEvent) => {
      if (mEvent.getType() === AccountDataEvent.RoomNamePrivate) {
        setName(readName());
      }
    };
    room.on(RoomEvent.AccountData, handleAccountData);
    return () => {
      room.removeListener(RoomEvent.AccountData, handleAccountData);
    };
  }, [room, readName]);

  return name;
};

export const useSetRoomNamePrivate = () => {
  const mx = useMatrixClient();

  return useCallback(
    (room: Room, name: string | undefined) => {
      // `undefined` clears the override via the empty object (MSC4431 removal).
      const content: RoomNamePrivateContent = name === undefined ? {} : { name };
      mx.setRoomAccountData(room.roomId, AccountDataEvent.RoomNamePrivate as any, content as any);
    },
    [mx]
  );
};

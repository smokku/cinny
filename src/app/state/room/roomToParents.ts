import produce from 'immer';
import { atom, useSetAtom } from 'jotai';
import {
  ClientEvent,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomEvent,
  RoomStateEvent,
} from 'matrix-js-sdk';
import { useEffect, useMemo } from 'react';
import { Membership, RoomToParents, StateEvent } from '../../../types/matrix/room';
import {
  getRoomToParents,
  getSpaceChildren,
  isSpace,
  isValidChild,
  mapParentWithChildren,
} from '../../utils/room';

export type RoomToParentsAction =
  | {
      type: 'INITIALIZE';
      roomToParents: RoomToParents;
    }
  | {
      type: 'PUT';
      parent: string;
      children: string[];
    }
  | {
      type: 'DELETE';
      roomId: string;
    };

// ---------------------------------------------------------------------------
// Per-account storage (Map<userId, RoomToParents>)
// ---------------------------------------------------------------------------
export const roomToParentsByAccountAtom = atom<Map<string, RoomToParents>>(new Map());

const accountParentsCache = new Map<string, ReturnType<typeof createAccountParentsAtom>>();

function applyParentsAction(prev: RoomToParents, action: RoomToParentsAction): RoomToParents {
  if (action.type === 'INITIALIZE') {
    return action.roomToParents;
  }
  if (action.type === 'PUT') {
    return produce(prev, (draft) => {
      mapParentWithChildren(draft, action.parent, action.children);
    });
  }
  // DELETE
  return produce(prev, (draft) => {
    const noParentRooms: string[] = [];
    draft.delete(action.roomId);
    draft.forEach((parents, child) => {
      parents.delete(action.roomId);
      if (parents.size === 0) noParentRooms.push(child);
    });
    noParentRooms.forEach((room) => draft.delete(room));
  });
}

function createAccountParentsAtom(userId: string) {
  return atom<RoomToParents, [RoomToParentsAction], void>(
    (get) => get(roomToParentsByAccountAtom).get(userId) ?? new Map(),
    (get, set, action) => {
      const prev = get(roomToParentsByAccountAtom).get(userId) ?? new Map();
      const next = applyParentsAction(prev, action);

      set(roomToParentsByAccountAtom, (prevMap) => {
        const nextMap = new Map(prevMap);
        nextMap.set(userId, next);
        return nextMap;
      });
    }
  );
}

export function getAccountParentsAtom(userId: string) {
  let a = accountParentsCache.get(userId);
  if (!a) {
    a = createAccountParentsAtom(userId);
    accountParentsCache.set(userId, a);
  }
  return a;
}

// ---------------------------------------------------------------------------
// Aggregated read-only atom (merge parent maps from all accounts)
// ---------------------------------------------------------------------------
export const roomToParentsAtom = atom<RoomToParents>((get) => {
  const byAccount = get(roomToParentsByAccountAtom);
  const merged: RoomToParents = new Map();
  byAccount.forEach((accountParents) => {
    accountParents.forEach((parents, childId) => {
      const existing = merged.get(childId);
      if (!existing) {
        merged.set(childId, new Set(parents));
      } else {
        parents.forEach((p) => existing.add(p));
      }
    });
  });
  return merged;
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
export const removeAccountParentsAtom = atom(null, (_get, set, userId: string) => {
  set(roomToParentsByAccountAtom, (prev) => {
    const next = new Map(prev);
    next.delete(userId);
    return next;
  });
});

// ---------------------------------------------------------------------------
// Binding hook (per-account)
// ---------------------------------------------------------------------------
export const useBindRoomToParentsAtom = (mx: MatrixClient) => {
  const userId = mx.getSafeUserId();
  const accountAtom = useMemo(() => getAccountParentsAtom(userId), [userId]);
  const setRoomToParents = useSetAtom(accountAtom);

  useEffect(() => {
    setRoomToParents({ type: 'INITIALIZE', roomToParents: getRoomToParents(mx) });

    const handleAddRoom = (room: Room) => {
      if (isSpace(room) && room.getMyMembership() !== Membership.Invite) {
        setRoomToParents({ type: 'PUT', parent: room.roomId, children: getSpaceChildren(room) });
      }
    };

    const handleMembershipChange = (room: Room, membership: string) => {
      if (isSpace(room) && room.getMyMembership() === Membership.Leave) {
        setRoomToParents({ type: 'DELETE', roomId: room.roomId });
        return;
      }
      if (isSpace(room) && membership === Membership.Join) {
        setRoomToParents({ type: 'PUT', parent: room.roomId, children: getSpaceChildren(room) });
      }
    };

    const handleStateChange = (mEvent: MatrixEvent) => {
      if (mEvent.getType() === StateEvent.SpaceChild) {
        const childId = mEvent.getStateKey();
        const roomId = mEvent.getRoomId();
        if (childId && roomId) {
          if (isValidChild(mEvent)) {
            setRoomToParents({ type: 'PUT', parent: roomId, children: [childId] });
          } else {
            setRoomToParents({ type: 'DELETE', roomId: childId });
          }
        }
      }
    };

    const handleDeleteRoom = (roomId: string) => {
      setRoomToParents({ type: 'DELETE', roomId });
    };

    mx.on(ClientEvent.Room, handleAddRoom);
    mx.on(RoomEvent.MyMembership, handleMembershipChange);
    mx.on(RoomStateEvent.Events, handleStateChange);
    mx.on(ClientEvent.DeleteRoom, handleDeleteRoom);
    return () => {
      mx.removeListener(ClientEvent.Room, handleAddRoom);
      mx.removeListener(RoomEvent.MyMembership, handleMembershipChange);
      mx.removeListener(RoomStateEvent.Events, handleStateChange);
      mx.removeListener(ClientEvent.DeleteRoom, handleDeleteRoom);
    };
  }, [mx, setRoomToParents]);
};

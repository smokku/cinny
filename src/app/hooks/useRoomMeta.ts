import { useEffect, useMemo, useState } from 'react';
import { RoomJoinRulesEventContent } from 'matrix-js-sdk/lib/types';
import { Room, RoomEvent, RoomEventHandlerMap } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { StateEvent } from '../../types/matrix/room';
import { useStateEvent } from './useStateEvent';
import { nicknamesAtom } from '../state/nicknames';
import { useRoomNamePrivate } from './useRoomNamePrivate';

export const useRoomAvatar = (room: Room, dm?: boolean): string | undefined => {
  const avatarEvent = useStateEvent(room, StateEvent.RoomAvatar);
  const content = avatarEvent?.getContent();
  const avatarMxc = content && typeof content.url === 'string' ? content.url : undefined;

  if (avatarMxc) return avatarMxc;
  if (dm) return room.getAvatarFallbackMember()?.getMxcAvatarUrl();
  return undefined;
};

export const useRoomBanner = (room: Room): string | undefined => {
  const bannerEvent = useStateEvent(room, StateEvent.RoomBanner);

  const content = bannerEvent?.getContent();
  const bannerMxc = content && typeof content.url === 'string' ? content.url : undefined;

  return bannerMxc;
};

export const useRoomName = (room: Room): string => {
  const [name, setName] = useState(room.name);

  useEffect(() => {
    setName(room.name);

    const handleRoomNameChange: RoomEventHandlerMap[RoomEvent.Name] = () => {
      setName(room.name);
    };
    room.on(RoomEvent.Name, handleRoomNameChange);
    return () => {
      room.removeListener(RoomEvent.Name, handleRoomNameChange);
    };
  }, [room]);

  return name;
};

export const useRoomNickname = (room: Room, direct?: boolean): string => {
  const sdkName = useRoomName(room);
  const nameEvent = useStateEvent(room, StateEvent.RoomName);
  const nicknames = useAtomValue(nicknamesAtom);
  // MSC4431 — personal room name override takes priority over any computed name.
  const privateName = useRoomNamePrivate(room);

  return useMemo(() => {
    if (typeof privateName === 'string') return privateName;

    const explicitName = nameEvent?.getContent().name;
    const hasExplicitName = typeof explicitName === 'string' && explicitName.length > 0;
    if (direct && !hasExplicitName) {
      const other = room.getAvatarFallbackMember();
      if (other) {
        const nick = nicknames?.[other.userId];
        if (nick) return nick;
      }
    }
    return sdkName;
  }, [direct, room, sdkName, nameEvent, nicknames, privateName]);
};

export const useRoomTopic = (room: Room): string | undefined => {
  const topicEvent = useStateEvent(room, StateEvent.RoomTopic);

  const content = topicEvent?.getContent();
  const topic = content && typeof content.topic === 'string' ? content.topic : undefined;

  return topic;
};

export const useRoomJoinRule = (room: Room): RoomJoinRulesEventContent | undefined => {
  const mEvent = useStateEvent(room, StateEvent.RoomJoinRules);
  const joinRuleContent = mEvent?.getContent<RoomJoinRulesEventContent>();
  return joinRuleContent;
};

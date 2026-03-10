import { useEffect, useMemo, useState } from 'react';
import { MatrixEvent, User, UserEvent } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';

export enum Presence {
  Online = 'online',
  Unavailable = 'unavailable',
  Offline = 'offline',
}

export type UserPresence = {
  presence: Presence;
  status?: string;
  active: boolean;
  lastActiveTs?: number;
};

const getPresenceStatus = (user: User, event?: MatrixEvent): string | undefined => {
  if (!event || event.getType() !== 'm.presence') return user.presenceStatusMsg;

  const content = event.getContent() as Record<string, unknown>;

  if ('status_msg' in content) {
    return typeof content.status_msg === 'string' ? content.status_msg : undefined;
  }

  // Event updated presence but not status_msg — clear it
  return content.presence ? undefined : user.presenceStatusMsg;
};

const getUserPresence = (user: User, event?: MatrixEvent): UserPresence => ({
  presence: user.presence as Presence,
  status: getPresenceStatus(user, event),
  active: user.currentlyActive,
  lastActiveTs: user.getLastActiveTs(),
});

export const useUserPresence = (userId: string): UserPresence | undefined => {
  const mx = useMatrixClient();
  const user = mx.getUser(userId);

  const [presence, setPresence] = useState(() =>
    user ? getUserPresence(user, user.events.presence) : undefined
  );

  useEffect(() => {
    const updatePresence = (event: MatrixEvent | undefined, u: User) => {
      if (u.userId === user?.userId) {
        setPresence(getUserPresence(user, event ?? user.events.presence));
      }
    };
    user?.on(UserEvent.Presence, updatePresence);
    user?.on(UserEvent.CurrentlyActive, updatePresence);
    user?.on(UserEvent.LastPresenceTs, updatePresence);
    return () => {
      user?.removeListener(UserEvent.Presence, updatePresence);
      user?.removeListener(UserEvent.CurrentlyActive, updatePresence);
      user?.removeListener(UserEvent.LastPresenceTs, updatePresence);
    };
  }, [user]);

  return presence;
};

export const usePresenceLabel = (): Record<Presence, string> =>
  useMemo(
    () => ({
      [Presence.Online]: 'Active',
      [Presence.Unavailable]: 'Busy',
      [Presence.Offline]: 'Away',
    }),
    []
  );

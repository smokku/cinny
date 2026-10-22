import { MatrixClient, SetPresence } from 'matrix-js-sdk';
import { Presence } from '../hooks/useUserPresence';
import { getPresenceSyncManager } from '../../client/initMatrix';

const PRESENCE_TO_SET_PRESENCE: Record<Presence, SetPresence> = {
  [Presence.Online]: SetPresence.Online,
  [Presence.Unavailable]: SetPresence.Unavailable,
  [Presence.Offline]: SetPresence.Offline,
};

export const presence2SetPresence = (presence: Presence): SetPresence =>
  PRESENCE_TO_SET_PRESENCE[presence];

export const setUserPresence = async (
  mx: MatrixClient,
  presence: Presence,
  statusMsg?: string
): Promise<void> => {
  const setPresence = presence2SetPresence(presence);
  await mx.setSyncPresence(setPresence);
  // Sliding sync carries no presence; its presence poll broadcasts it instead.
  getPresenceSyncManager(mx)?.setDesiredPresence(setPresence);
  await mx.setPresence({
    presence,
    status_msg: statusMsg,
  });
};

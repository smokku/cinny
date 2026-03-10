import { useEffect, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { Room } from 'matrix-js-sdk';
import { profilesCacheAtom } from '../state/userRoomProfile';
import { useMatrixClient } from './useMatrixClient';

const inFlightProfiles = new Map<string, Promise<any>>();

export type UserProfile = {
  avatarUrl?: string;
  displayName?: string;
  pronouns?: any[];
  timezone?: string;
  bio?: string;
  status?: string;
  bannerUrl?: string;
  extended?: Record<string, any>;
  _fetched?: boolean;
};

const normalizeInfo = (info: any): UserProfile => {
  const knownKeys = [
    'avatar_url',
    'displayname',
    'io.fsky.nyx.pronouns',
    'us.cloke.msc4175.tz',
    'm.tz',
    'moe.sable.app.bio',
    'chat.commet.profile_bio',
    'chat.commet.profile_banner',
    'chat.commet.profile_status',
  ];

  const extended: Record<string, any> = {};
  Object.entries(info).forEach(([key, value]) => {
    if (!knownKeys.includes(key)) {
      extended[key] = value;
    }
  });

  return {
    avatarUrl: info.avatar_url,
    displayName: info.displayname,
    pronouns: info['io.fsky.nyx.pronouns'],
    timezone: info['us.cloke.msc4175.tz'] || info['m.tz'],
    bio: info['moe.sable.app.bio'] || info['chat.commet.profile_bio'],
    status: info['chat.commet.profile_status'],
    bannerUrl: info['chat.commet.profile_banner'],
    extended,
    _fetched: true,
  };
};

export const useUserProfile = (
  userId: string,
  _room?: Room,
  initialProfile?: Partial<UserProfile>
): UserProfile => {
  const mx = useMatrixClient();
  const userSelector = useMemo(() => selectAtom(profilesCacheAtom, (db) => db[userId]), [userId]);

  const cached = useAtomValue(userSelector);
  const setGlobalProfiles = useSetAtom(profilesCacheAtom);

  const needsFetch = !!userId && userId !== 'undefined' && !cached?._fetched;

  useEffect(() => {
    if (!needsFetch) return undefined;

    let fetchPromise = inFlightProfiles.get(userId);

    if (!fetchPromise) {
      fetchPromise = mx.getProfileInfo(userId).finally(() => {
        inFlightProfiles.delete(userId);
      });
      inFlightProfiles.set(userId, fetchPromise);
    }

    let isMounted = true;

    fetchPromise
      .then((info: any) => {
        if (!isMounted) return;
        const normalized = normalizeInfo(info);
        setGlobalProfiles((prev) => ({
          ...prev,
          [userId]: { ...prev[userId], ...normalized },
        }));
      })
      .catch(() => {
        if (!isMounted) return;
        setGlobalProfiles((prev) => ({
          ...prev,
          [userId]: { ...prev[userId], _fetched: true },
        }));
      });

    return () => {
      isMounted = false;
    };
  }, [userId, needsFetch, mx, setGlobalProfiles]);

  return useMemo(() => {
    const fallback: UserProfile = {
      displayName: initialProfile?.displayName ?? mx.getUser(userId)?.displayName,
      avatarUrl: initialProfile?.avatarUrl ?? mx.getUser(userId)?.avatarUrl,
      ...initialProfile,
    };

    if (!cached) return fallback;

    return {
      ...fallback,
      ...cached,
    };
  }, [cached, userId, mx, initialProfile]);
};

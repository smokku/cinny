import { Position, RectCords } from 'folds';
import { atom } from 'jotai';
import type { UserProfile } from '../hooks/useUserProfile';

export type UserRoomProfileState = {
  userId: string;
  roomId: string;
  spaceId?: string;
  cords: RectCords;
  position?: Position;
  initialProfile?: Partial<UserProfile>;
};

export const userRoomProfileAtom = atom<UserRoomProfileState | undefined>(undefined);

const MAX_PROFILES = 2000;
const TRIM_TARGET = 1500;

const baseProfilesCacheAtom = atom<Record<string, UserProfile>>({});

export const profilesCacheAtom = atom(
  (get) => get(baseProfilesCacheAtom),
  (
    _get,
    set,
    update:
      | Record<string, UserProfile>
      | ((prev: Record<string, UserProfile>) => Record<string, UserProfile>)
  ) => {
    set(baseProfilesCacheAtom, (prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      const keys = Object.keys(next);
      if (keys.length <= MAX_PROFILES) return next;

      // Trim oldest entries (first in object insertion order) down to TRIM_TARGET
      const trimmed: Record<string, UserProfile> = {};
      const skip = keys.length - TRIM_TARGET;
      for (let i = skip; i < keys.length; i += 1) {
        trimmed[keys[i]] = next[keys[i]];
      }
      return trimmed;
    });
  }
);

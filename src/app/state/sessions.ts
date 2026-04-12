import { atom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from './utils/atomWithLocalStorage';

export type Session = {
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  expiresInMs?: number;
  refreshToken?: string;
  fallbackSdkStores?: boolean;
};

export type Sessions = Session[];
export type SessionStoreName = {
  sync: string;
  crypto: string;
  /** Prefix for the Rust crypto IndexedDB: actual DB is `${rustCryptoPrefix}::matrix-sdk-crypto` */
  rustCryptoPrefix: string;
};

const FALLBACK_STORE_NAME: SessionStoreName = {
  sync: 'web-sync-store',
  crypto: 'crypto-store',
  rustCryptoPrefix: 'matrix-js-sdk',
} as const;

/**
 * Legacy single-session migration helpers.
 * Used only on first boot to migrate old localStorage keys into matrixSessions.
 */
function setFallbackSession(
  accessToken: string,
  deviceId: string,
  userId: string,
  baseUrl: string
) {
  localStorage.setItem('cinny_access_token', accessToken);
  localStorage.setItem('cinny_device_id', deviceId);
  localStorage.setItem('cinny_user_id', userId);
  localStorage.setItem('cinny_hs_base_url', baseUrl);
}
const removeFallbackSession = () => {
  localStorage.removeItem('cinny_hs_base_url');
  localStorage.removeItem('cinny_user_id');
  localStorage.removeItem('cinny_device_id');
  localStorage.removeItem('cinny_access_token');
};
const getFallbackSession = (): Session | undefined => {
  const baseUrl = localStorage.getItem('cinny_hs_base_url');
  const userId = localStorage.getItem('cinny_user_id');
  const deviceId = localStorage.getItem('cinny_device_id');
  const accessToken = localStorage.getItem('cinny_access_token');

  if (baseUrl && userId && deviceId && accessToken) {
    return {
      baseUrl,
      userId,
      deviceId,
      accessToken,
      fallbackSdkStores: true,
    };
  }

  return undefined;
};

// Re-export for login/register completion flows that still write a new session
export { setFallbackSession, removeFallbackSession, getFallbackSession };

// ---------------------------------------------------------------------------
// Per-account IndexedDB store name resolution
// ---------------------------------------------------------------------------
export const getSessionStoreName = (session: Session): SessionStoreName => {
  if (session.fallbackSdkStores) {
    return FALLBACK_STORE_NAME;
  }

  return {
    sync: `sync${session.userId}`,
    crypto: `crypto${session.userId}`,
    rustCryptoPrefix: `sync${session.userId}`,
  };
};

// ---------------------------------------------------------------------------
// Multi-session persistence atoms
// ---------------------------------------------------------------------------
export const MATRIX_SESSIONS_KEY = 'matrixSessions';
const baseSessionsAtom = atomWithLocalStorage<Sessions>(
  MATRIX_SESSIONS_KEY,
  (key) => {
    const defaultSessions: Sessions = [];
    const sessions = getLocalStorageItem(key, defaultSessions);

    // Migrate legacy single-session localStorage keys on first boot.
    const fallbackSession = getFallbackSession();
    if (fallbackSession) {
      removeFallbackSession();
      sessions.push(fallbackSession);
      setLocalStorageItem(key, sessions);
    }
    return sessions;
  },
  (key, value) => {
    setLocalStorageItem(key, value);
  }
);

export type SessionsAction =
  | {
      type: 'PUT';
      session: Session;
    }
  | {
      type: 'DELETE';
      session: Session;
    };

export const sessionsAtom = atom<Sessions, [SessionsAction], undefined>(
  (get) => get(baseSessionsAtom),
  (get, set, action) => {
    if (action.type === 'PUT') {
      const sessions = [...get(baseSessionsAtom)];
      const sessionIndex = sessions.findIndex(
        (session) => session.userId === action.session.userId
      );
      if (sessionIndex === -1) {
        sessions.push(action.session);
      } else {
        sessions.splice(sessionIndex, 1, action.session);
      }
      set(baseSessionsAtom, sessions);
      return;
    }
    if (action.type === 'DELETE') {
      const sessions = get(baseSessionsAtom).filter(
        (session) => session.userId !== action.session.userId
      );
      set(baseSessionsAtom, sessions);
    }
  }
);

// ---------------------------------------------------------------------------
// Current account and room-owner persistence
// ---------------------------------------------------------------------------
export const CURRENT_ACCOUNT_KEY = 'currentAccountId';
const baseCurrentAccountAtom = atomWithLocalStorage<string | null>(
  CURRENT_ACCOUNT_KEY,
  (key) => getLocalStorageItem<string | null>(key, null),
  (key, value) => setLocalStorageItem(key, value)
);
export const currentAccountIdAtom = atom<string | null, [string | null], undefined>(
  (get) => get(baseCurrentAccountAtom),
  (_get, set, value) => {
    set(baseCurrentAccountAtom, value);
  }
);

export const ROOM_OWNER_KEY = 'roomOwnerByRoomId';
const baseRoomOwnerAtom = atomWithLocalStorage<Record<string, string>>(
  ROOM_OWNER_KEY,
  (key) => getLocalStorageItem<Record<string, string>>(key, {}),
  (key, value) => setLocalStorageItem(key, value)
);
export const roomOwnerByRoomIdAtom = atom<
  Record<string, string>,
  [Record<string, string>],
  undefined
>(
  (get) => get(baseRoomOwnerAtom),
  (_get, set, value) => {
    set(baseRoomOwnerAtom, value);
  }
);

// ---------------------------------------------------------------------------
// Convenience: read sessions without React/Jotai context (route loaders, SW sync)
// ---------------------------------------------------------------------------
export const getStoredSessions = (): Sessions =>
  getLocalStorageItem<Sessions>(MATRIX_SESSIONS_KEY, []);

export const hasStoredSession = (): boolean => getStoredSessions().length > 0;

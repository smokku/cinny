import { createClient, MatrixClient, IndexedDBStore, IndexedDBCryptoStore } from 'matrix-js-sdk';

import { quietMatrixLogger } from './matrixLogger';
import { cryptoCallbacks } from './secretStorageKeys';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { pushSessionToSW } from '../sw-session';
import { Session, SessionStoreName, getSessionStoreName } from '../app/state/sessions';

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------
const deleteDatabase = (name: string): Promise<void> =>
  new Promise((resolve) => {
    const req = window.indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });

const deleteSessionStores = async (storeName: SessionStoreName): Promise<void> => {
  await Promise.all([
    deleteDatabase(storeName.sync),
    deleteDatabase(storeName.crypto),
    deleteDatabase(`${storeName.rustCryptoPrefix}::matrix-sdk-crypto`),
  ]);
};

// ---------------------------------------------------------------------------
// Client build & init (per-account store isolation)
// ---------------------------------------------------------------------------
const buildClient = async (session: Session): Promise<MatrixClient> => {
  const storeName = getSessionStoreName(session);

  const indexedDBStore = new IndexedDBStore({
    indexedDB: global.indexedDB,
    localStorage: global.localStorage,
    dbName: storeName.sync,
  });

  const legacyCryptoStore = new IndexedDBCryptoStore(global.indexedDB, storeName.crypto);

  const mx = createClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    store: indexedDBStore,
    cryptoStore: legacyCryptoStore,
    deviceId: session.deviceId,
    timelineSupport: true,
    cryptoCallbacks: cryptoCallbacks as any,
    verificationMethods: ['m.sas.v1'],
    logger: quietMatrixLogger,
  });

  await indexedDBStore.startup();
  return mx;
};

export const initClient = async (session: Session): Promise<MatrixClient> => {
  const storeName = getSessionStoreName(session);

  const isMismatch = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes("doesn't match") ||
      msg.includes('does not match') ||
      msg.includes('account in the store') ||
      msg.includes('account in the constructor')
    );
  };

  const wipeAllStores = async () => {
    await deleteSessionStores(storeName);
    try {
      const allDbs = await window.indexedDB.databases();
      await Promise.all(
        allDbs.map(async ({ name }) => {
          if (name && name.includes(session.userId)) {
            await deleteDatabase(name);
          }
        })
      );
    } catch {
      // databases() not available in all browsers
    }
  };

  let mx: MatrixClient;
  try {
    mx = await buildClient(session);
  } catch (err) {
    if (!isMismatch(err)) throw err;
    await wipeAllStores();
    mx = await buildClient(session);
  }

  try {
    await mx.initRustCrypto({ cryptoDatabasePrefix: storeName.rustCryptoPrefix });
  } catch (err) {
    if (!isMismatch(err)) throw err;
    mx.stopClient();
    await wipeAllStores();
    mx = await buildClient(session);
    await mx.initRustCrypto({ cryptoDatabasePrefix: storeName.rustCryptoPrefix });
  }

  mx.setMaxListeners(50);
  mx.matrixRTC.setMaxListeners(50);

  return mx;
};

export const startClient = async (mx: MatrixClient) => {
  await mx.startClient({
    lazyLoadMembers: true,
    threadSupport: true,
  });
};

// ---------------------------------------------------------------------------
// Targeted per-account cleanup
// ---------------------------------------------------------------------------
export const stopClient = (mx: MatrixClient): void => {
  mx.stopClient();
};

export const clearCacheAndReload = async (mx: MatrixClient) => {
  mx.stopClient();
  clearNavToActivePathStore(mx.getSafeUserId());
  await mx.store.deleteAllData();
  window.location.reload();
};

/**
 * Log out a single account. Cleans only that account's SDK stores.
 * Callers must handle the Jotai sessionsAtom DELETE separately.
 */
export const logoutClient = async (mx: MatrixClient, session?: Session) => {
  pushSessionToSW();
  mx.stopClient();
  try {
    await mx.logout();
  } catch {
    // ignore if failed to logout
  }

  if (session) {
    const storeName = getSessionStoreName(session);
    await mx.clearStores({ cryptoDatabasePrefix: storeName.rustCryptoPrefix });
    await deleteSessionStores(storeName);
    clearNavToActivePathStore(session.userId);
  } else {
    await mx.clearStores();
    window.localStorage.clear();
    window.location.reload();
  }
};

/**
 * Nuclear option: delete everything and reload.
 * Used only when all accounts are removed or data is corrupted.
 */
export const clearLoginData = async () => {
  pushSessionToSW();

  const dbs = await window.indexedDB.databases();

  dbs.forEach((idbInfo) => {
    const { name } = idbInfo;
    if (name) {
      window.indexedDB.deleteDatabase(name);
    }
  });

  window.localStorage.clear();
  window.location.reload();
};

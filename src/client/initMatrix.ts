import {
  ClientEvent,
  createClient,
  MatrixClient,
  IndexedDBStore,
  IndexedDBCryptoStore,
  SyncState,
} from 'matrix-js-sdk';

import { quietMatrixLogger } from './matrixLogger';
import { cryptoCallbacks } from './secretStorageKeys';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { pushSessionToSW } from '../sw-session';
import { SlidingSyncConfig, SlidingSyncDiagnostics, SlidingSyncManager } from './slidingSync';

const log = quietMatrixLogger.getChild('initMatrix');

type Session = {
  baseUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
};

// --- Sliding sync transport tracking ---

type SyncTransport = 'classic' | 'sliding';
type SyncTransportReason =
  | 'sliding_active'
  | 'sliding_disabled_server'
  | 'session_opt_out'
  | 'missing_proxy'
  | 'cold_cache_bootstrap'
  | 'probe_failed_fallback'
  | 'unknown';

type SyncTransportMeta = {
  transport: SyncTransport;
  slidingConfigured: boolean;
  slidingEnabledOnServer: boolean;
  sessionOptIn: boolean;
  slidingRequested: boolean;
  fallbackFromSliding: boolean;
  reason: SyncTransportReason;
};

const slidingSyncByClient = new WeakMap<MatrixClient, SlidingSyncManager>();
const classicSyncObserverByClient = new WeakMap<
  MatrixClient,
  (state: SyncState, prevState: SyncState | null) => void
>();
const syncTransportByClient = new WeakMap<MatrixClient, SyncTransportMeta>();

const SLIDING_SYNC_POLL_TIMEOUT_MS = 20000;
const COLD_CACHE_BOOTSTRAP_TIMEOUT_MS = 20000;

// --- Helpers ---

export const resolveSlidingEnabled = (enabled: SlidingSyncConfig['enabled']): boolean => {
  if (enabled === undefined) return false;
  if (typeof enabled === 'boolean') return enabled;
  const normalized = String(enabled).trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === 'off' || normalized === 'no')
    return false;
  if (normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes')
    return true;
  return false;
};

/**
 * Reads the account stored in an IndexedDB sync store without opening a full MatrixClient.
 * Returns undefined if the database doesn't exist or has no account record.
 */
const readStoredAccount = (dbName: string): Promise<string | undefined> =>
  new Promise((resolve) => {
    const req = window.indexedDB.open(dbName);
    req.onerror = () => resolve(undefined);
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains('account')) {
          db.close();
          resolve(undefined);
        } else {
          const tx = db.transaction('account', 'readonly');
          const store = tx.objectStore('account');
          const getReq = store.get('account');
          getReq.onsuccess = () => {
            db.close();
            const record = getReq.result;
            if (!record?.account_data) {
              resolve(undefined);
            } else {
              try {
                const data = JSON.parse(record.account_data);
                resolve(data?.user_id ?? undefined);
              } catch {
                resolve(undefined);
              }
            }
          };
          getReq.onerror = () => {
            db.close();
            resolve(undefined);
          };
        }
      } catch {
        try {
          db.close();
        } catch {
          /* ignore */
        }
        resolve(undefined);
      }
    };
  });

const databaseExists = async (dbName: string): Promise<boolean> => {
  try {
    const dbs = await window.indexedDB.databases();
    return dbs.some((db) => db.name === dbName);
  } catch {
    return false;
  }
};

const isClientReadyForUi = (syncState: string | null): boolean =>
  syncState === 'PREPARED' || syncState === 'SYNCING' || syncState === 'CATCHUP';

const waitForClientReady = (mx: MatrixClient, timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    if (isClientReadyForUi(mx.getSyncState())) {
      resolve();
      return;
    }

    let timer = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      mx.removeListener(ClientEvent.Sync, onSync);
      clearTimeout(timer);
      resolve();
    };
    const onSync = (state: string) => {
      if (isClientReadyForUi(state)) finish();
    };

    timer = window.setTimeout(finish, timeoutMs);
    mx.on(ClientEvent.Sync, onSync);
  });

const disposeSlidingSync = (mx: MatrixClient): void => {
  const manager = slidingSyncByClient.get(mx);
  if (!manager) return;
  manager.dispose();
  slidingSyncByClient.delete(mx);
};

export const getSlidingSyncManager = (mx: MatrixClient): SlidingSyncManager | undefined =>
  slidingSyncByClient.get(mx);

export type StartClientConfig = {
  baseUrl?: string;
  slidingSync?: SlidingSyncConfig;
  sessionSlidingSyncOptIn?: boolean;
};

export type ClientSyncDiagnostics = SyncTransportMeta & {
  syncState: string | null;
  sliding?: SlidingSyncDiagnostics;
};

export const getClientSyncDiagnostics = (mx: MatrixClient): ClientSyncDiagnostics => {
  const meta = syncTransportByClient.get(mx) ?? {
    transport: 'classic' as const,
    slidingConfigured: false,
    slidingEnabledOnServer: false,
    sessionOptIn: false,
    slidingRequested: false,
    fallbackFromSliding: false,
    reason: 'unknown' as const,
  };
  return {
    ...meta,
    syncState: mx.getSyncState(),
    sliding: slidingSyncByClient.get(mx)?.getDiagnostics(),
  };
};

// --- Client lifecycle ---

export const initClient = async (session: Session): Promise<MatrixClient> => {
  const indexedDBStore = new IndexedDBStore({
    indexedDB: global.indexedDB,
    localStorage: global.localStorage,
    dbName: 'web-sync-store',
  });

  const legacyCryptoStore = new IndexedDBCryptoStore(global.indexedDB, 'crypto-store');

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
  await mx.initRustCrypto();

  mx.setMaxListeners(50);
  mx.matrixRTC.setMaxListeners(50);

  return mx;
};

export const startClient = async (mx: MatrixClient, config?: StartClientConfig): Promise<void> => {
  disposeSlidingSync(mx);
  const slidingConfig = config?.slidingSync;
  const slidingEnabledOnServer = resolveSlidingEnabled(slidingConfig?.enabled);
  const slidingRequested = slidingEnabledOnServer && config?.sessionSlidingSyncOptIn === true;
  const proxyBaseUrl = slidingConfig?.proxyBaseUrl ?? config?.baseUrl;
  const hasSlidingProxy = typeof proxyBaseUrl === 'string' && proxyBaseUrl.trim().length > 0;

  log.info('startClient sliding config', {
    enabledOnServer: slidingEnabledOnServer,
    requested: slidingRequested,
    hasProxy: hasSlidingProxy,
  });

  const startClassicSync = async (fallbackFromSliding: boolean, reason: SyncTransportReason) => {
    syncTransportByClient.set(mx, {
      transport: 'classic',
      slidingConfigured: slidingEnabledOnServer,
      slidingEnabledOnServer,
      sessionOptIn: config?.sessionSlidingSyncOptIn === true,
      slidingRequested,
      fallbackFromSliding,
      reason,
    });
    await mx.startClient({
      lazyLoadMembers: true,
      threadSupport: true,
    });
    const classicSyncListener = (state: SyncState) => {
      if (state === SyncState.Error || state === SyncState.Reconnecting) {
        log.warn(`Classic sync problem: ${state}`);
      }
    };
    classicSyncObserverByClient.set(mx, classicSyncListener);
    mx.on(ClientEvent.Sync, classicSyncListener);
  };

  const shouldBootstrapClassicOnColdCache = async (): Promise<boolean> => {
    if (slidingConfig?.bootstrapClassicOnColdCache === false) return false;
    const userId = mx.getUserId();
    if (!userId) return false;

    const [storeHasAccount, fallbackStoreHasAccount, hasStoreDb, hasFallbackStoreDb] =
      await Promise.all([
        readStoredAccount(`sync${userId}`),
        readStoredAccount('web-sync-store'),
        databaseExists(`sync${userId}`),
        databaseExists('web-sync-store'),
      ]);

    const hasWarmCache =
      storeHasAccount === userId ||
      fallbackStoreHasAccount === userId ||
      hasStoreDb ||
      hasFallbackStoreDb;

    return !hasWarmCache;
  };

  // Decision tree: determine sync transport
  if (!slidingEnabledOnServer || !slidingRequested) {
    await startClassicSync(
      false,
      slidingEnabledOnServer ? 'session_opt_out' : 'sliding_disabled_server'
    );
    return;
  }

  if (!hasSlidingProxy) {
    await startClassicSync(false, 'missing_proxy');
    return;
  }

  if (await shouldBootstrapClassicOnColdCache()) {
    log.info('Cold-cache bootstrap: using classic sync for this run');
    await startClassicSync(false, 'cold_cache_bootstrap');
    waitForClientReady(mx, COLD_CACHE_BOOTSTRAP_TIMEOUT_MS).catch(() => {
      log.warn('Cold cache bootstrap timed out');
    });
    return;
  }

  const resolvedProxyBaseUrl = proxyBaseUrl!;
  const probeTimeoutMs = (() => {
    const v = slidingConfig?.probeTimeoutMs;
    return typeof v === 'number' && !Number.isNaN(v) && v > 0 ? Math.round(v) : 5000;
  })();
  const supported = await SlidingSyncManager.probe(mx, resolvedProxyBaseUrl, probeTimeoutMs);
  if (!supported) {
    log.warn('Sliding Sync unavailable, falling back to classic sync');
    await startClassicSync(true, 'probe_failed_fallback');
    return;
  }

  const manager = new SlidingSyncManager(mx, resolvedProxyBaseUrl, {
    ...(slidingConfig ?? {}),
    includeInviteList: true,
    pollTimeoutMs: slidingConfig?.pollTimeoutMs ?? SLIDING_SYNC_POLL_TIMEOUT_MS,
  });
  manager.attach();
  // Begin background spidering so all rooms are eventually indexed.
  // Not awaited — this runs incrementally in the background.
  manager.startSpidering(100, 50);
  slidingSyncByClient.set(mx, manager);
  syncTransportByClient.set(mx, {
    transport: 'sliding',
    slidingConfigured: true,
    slidingEnabledOnServer,
    sessionOptIn: config?.sessionSlidingSyncOptIn === true,
    slidingRequested,
    fallbackFromSliding: false,
    reason: 'sliding_active',
  });

  try {
    await mx.startClient({
      lazyLoadMembers: true,
      threadSupport: true,
      slidingSync: manager.slidingSync,
    });
  } catch (err) {
    log.error('Failed to start client with sliding sync', err);
    disposeSlidingSync(mx);
    throw err;
  }
};

export const stopClient = (mx: MatrixClient): void => {
  disposeSlidingSync(mx);
  const classicSyncListener = classicSyncObserverByClient.get(mx);
  if (classicSyncListener) {
    mx.removeListener(ClientEvent.Sync, classicSyncListener);
    classicSyncObserverByClient.delete(mx);
  }
  mx.stopClient();
  syncTransportByClient.delete(mx);
};

export const clearCacheAndReload = async (mx: MatrixClient) => {
  stopClient(mx);
  clearNavToActivePathStore(mx.getSafeUserId());
  await mx.store.deleteAllData();
  window.location.reload();
};

export const logoutClient = async (mx: MatrixClient) => {
  pushSessionToSW();
  stopClient(mx);
  try {
    await mx.logout();
  } catch {
    // ignore if failed to logout
  }
  await mx.clearStores();
  window.localStorage.clear();
  window.location.reload();
};

export const clearLoginData = async () => {
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

import { createClient, MatrixClient, IndexedDBStore, IndexedDBCryptoStore } from 'matrix-js-sdk';
import {
  MSC3575SlidingSyncRequest,
  MSC3575SlidingSyncResponse,
} from 'matrix-js-sdk/lib/sliding-sync';

import { quietMatrixLogger } from './matrixLogger';
import { cryptoCallbacks } from './secretStorageKeys';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { pushSessionToSW } from '../sw-session';
import {
  prepareSlidingSyncTimelines,
  scopeTypingExtension,
  SlidingSyncManager,
} from './slidingSync';

type Session = {
  baseUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
};

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

const slidingSyncByClient = new WeakMap<MatrixClient, SlidingSyncManager>();
const slidingSyncRequestCleanupByClient = new WeakMap<MatrixClient, () => void>();

type SlidingSyncMethod = (
  reqBody: MSC3575SlidingSyncRequest,
  baseUrl?: string,
  abortSignal?: AbortSignal
) => Promise<MSC3575SlidingSyncResponse>;

type MatrixClientWithWritableSlidingSync = MatrixClient & {
  slidingSync: SlidingSyncMethod;
};

type SlidingSyncRequestWithConnId = MSC3575SlidingSyncRequest & {
  conn_id?: string;
};

// Synapse keys connection state on (user, device, conn_id) and keeps only the two
// latest positions, so two clients sharing an id invalidate each other's `pos`.
const newSlidingSyncConnId = (): string =>
  `cinny-${
    globalThis.crypto?.randomUUID?.().slice(0, 8) ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }`;

const installSlidingSyncRequestPatch = (mx: MatrixClient, manager: SlidingSyncManager): void => {
  slidingSyncRequestCleanupByClient.get(mx)?.();

  const connId = newSlidingSyncConnId();
  const mxWritable = mx as MatrixClientWithWritableSlidingSync;
  const original = mx.slidingSync.bind(mx) as SlidingSyncMethod;
  mxWritable.slidingSync = async (reqBody, baseUrl, abortSignal) => {
    const req = reqBody as SlidingSyncRequestWithConnId;
    const subscribedRoomIds = new Set(Object.keys(req.room_subscriptions ?? {}));

    if (req.conn_id === undefined) {
      req.conn_id = connId;
    }

    scopeTypingExtension(req.extensions, manager.getActiveRoomSubscriptionIds());

    const response = await original(reqBody, baseUrl, abortSignal);
    // Must run before the SDK processes the response. A throw would reach the SDK's
    // loop, which drops the response and retries the same `pos` forever.
    try {
      const completeTimelineReset = prepareSlidingSyncTimelines(response, mx, subscribedRoomIds);
      if (completeTimelineReset) {
        manager.trackTimelineResetCompletion(response, completeTimelineReset);
      }
    } catch (error) {
      console.error('Failed to prepare sliding sync response', error);
    }
    return response;
  };

  slidingSyncRequestCleanupByClient.set(mx, () => {
    slidingSyncRequestCleanupByClient.delete(mx);
    mxWritable.slidingSync = original;
  });
};

const SLIDING_SYNC_UNSTABLE_FEATURE = 'org.matrix.simplified_msc3575';

const SLIDING_SYNC_CAPABILITY_TIMEOUT_MS = 5000;

// The SDK retries an unsupported endpoint forever instead of erroring, so anything
// short of a confirmation falls back to classic sync. /versions has no timeout of
// its own, hence the race.
const supportsSlidingSync = async (mx: MatrixClient): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), SLIDING_SYNC_CAPABILITY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      mx.doesServerSupportUnstableFeature(SLIDING_SYNC_UNSTABLE_FEATURE),
      timeout,
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const disposeSlidingSync = (mx: MatrixClient): void => {
  slidingSyncRequestCleanupByClient.get(mx)?.();
  const manager = slidingSyncByClient.get(mx);
  if (!manager) return;
  manager.dispose();
  slidingSyncByClient.delete(mx);
};

export const getSlidingSyncManager = (mx: MatrixClient): SlidingSyncManager | undefined =>
  slidingSyncByClient.get(mx);

export type StartClientConfig = {
  slidingSync?: boolean;
  initialRoomIds?: Iterable<string>;
};

export const startClient = async (mx: MatrixClient, config?: StartClientConfig) => {
  disposeSlidingSync(mx);

  const useSliding = config?.slidingSync === true && (await supportsSlidingSync(mx));
  if (config?.slidingSync && !useSliding) {
    console.warn('Server does not advertise sliding sync support; falling back to classic sync');
  }

  let manager: SlidingSyncManager | undefined;
  if (useSliding) {
    manager = new SlidingSyncManager(mx, mx.baseUrl, {
      initialRoomIds: config?.initialRoomIds,
    });
    installSlidingSyncRequestPatch(mx, manager);
    manager.attach();
    slidingSyncByClient.set(mx, manager);
  }

  try {
    await mx.startClient({
      lazyLoadMembers: true,
      slidingSync: manager?.slidingSync,
      threadSupport: true,
    });
  } catch (err) {
    disposeSlidingSync(mx);
    throw err;
  }
};

export const stopClient = (mx: MatrixClient): void => {
  disposeSlidingSync(mx);
  mx.stopClient();
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

/// <reference lib="WebWorker" />

export type {};
declare const self: ServiceWorkerGlobalScope;

type SessionInfo = {
  accessToken: string;
  baseUrl: string;
};

const SW_SESSION_CACHE = 'cinny-sw-session-v1';
const SW_SESSION_URL = '/sw-session-meta';
const SW_MEDIA_CACHE = 'cinny-sw-media-v1';
const SW_MEDIA_META_CACHE = 'cinny-sw-media-meta-v1';
const SW_MEDIA_META_URL = '/sw-media-meta';
const SW_MEDIA_MAX_ENTRIES = 2000;

type MediaCacheMeta = Record<string, number>;

/**
 * Store session per client (tab)
 */
const sessions = new Map<string, SessionInfo>();

let persistedSession: SessionInfo | undefined;

const clientToResolve = new Map<string, (value: SessionInfo | undefined) => void>();
const clientToSessionPromise = new Map<string, Promise<SessionInfo | undefined>>();

async function persistSession(session: SessionInfo): Promise<void> {
  try {
    const cache = await self.caches.open(SW_SESSION_CACHE);
    await cache.put(
      SW_SESSION_URL,
      new Response(JSON.stringify(session), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  } catch {
    // Ignore cache persistence failures. Media requests can still use in-memory session state.
  }
}

async function clearPersistedSession(): Promise<void> {
  try {
    const cache = await self.caches.open(SW_SESSION_CACHE);
    await cache.delete(SW_SESSION_URL);
  } catch {
    // Ignore cache persistence failures.
  }
}

async function loadPersistedSession(): Promise<SessionInfo | undefined> {
  try {
    const cache = await self.caches.open(SW_SESSION_CACHE);
    const response = await cache.match(SW_SESSION_URL);
    if (!response) return undefined;

    const session = await response.json();
    if (typeof session.accessToken === 'string' && typeof session.baseUrl === 'string') {
      return {
        accessToken: session.accessToken,
        baseUrl: session.baseUrl,
      };
    }
  } catch {
    // Ignore invalid cache entries and fall through.
  }

  return undefined;
}

async function loadMediaCacheMeta(): Promise<MediaCacheMeta> {
  try {
    const cache = await self.caches.open(SW_MEDIA_META_CACHE);
    const response = await cache.match(SW_MEDIA_META_URL);
    if (!response) return {};

    const meta = await response.json();
    if (meta && typeof meta === 'object') {
      return Object.entries(meta).reduce<MediaCacheMeta>((acc, [url, ts]) => {
        if (typeof ts === 'number' && Number.isFinite(ts)) {
          acc[url] = ts;
        }
        return acc;
      }, {});
    }
  } catch {
    // Ignore invalid metadata and rebuild lazily.
  }

  return {};
}

async function saveMediaCacheMeta(meta: MediaCacheMeta): Promise<void> {
  try {
    const cache = await self.caches.open(SW_MEDIA_META_CACHE);
    await cache.put(
      SW_MEDIA_META_URL,
      new Response(JSON.stringify(meta), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  } catch {
    // Ignore metadata persistence failures. Cache entries can still be used.
  }
}

async function clearMediaCache(): Promise<void> {
  await Promise.all([self.caches.delete(SW_MEDIA_CACHE), self.caches.delete(SW_MEDIA_META_CACHE)]);
}

async function touchMediaCacheEntry(url: string): Promise<void> {
  const meta = await loadMediaCacheMeta();
  meta[url] = Date.now();
  await saveMediaCacheMeta(meta);
}

async function pruneMediaCache(meta: MediaCacheMeta): Promise<MediaCacheMeta> {
  const entries = Object.entries(meta);
  if (entries.length <= SW_MEDIA_MAX_ENTRIES) return meta;

  const mediaCache = await self.caches.open(SW_MEDIA_CACHE);
  const nextMeta = { ...meta };
  const staleEntries = entries
    .sort(([, firstTs], [, secondTs]) => firstTs - secondTs)
    .slice(0, entries.length - SW_MEDIA_MAX_ENTRIES);

  await Promise.all(
    staleEntries.map(async ([url]) => {
      delete nextMeta[url];
      await mediaCache.delete(url);
    })
  );

  return nextMeta;
}

async function getCachedMediaResponse(url: string): Promise<Response | undefined> {
  try {
    const cache = await self.caches.open(SW_MEDIA_CACHE);
    const response = await cache.match(url);
    if (!response) return undefined;

    await touchMediaCacheEntry(url);
    return response;
  } catch {
    return undefined;
  }
}

function cacheableMediaResponse(response: Response): boolean {
  return response.ok && (response.type === 'basic' || response.type === 'cors');
}

async function cacheMediaResponse(url: string, response: Response): Promise<void> {
  if (!cacheableMediaResponse(response)) return;

  const mediaCache = await self.caches.open(SW_MEDIA_CACHE);
  await mediaCache.put(url, response.clone());

  const meta = await loadMediaCacheMeta();
  meta[url] = Date.now();
  const nextMeta = await pruneMediaCache(meta);
  await saveMediaCacheMeta(nextMeta);
}

async function cleanupDeadClients() {
  const activeClients = await self.clients.matchAll();
  const activeIds = new Set(activeClients.map((c) => c.id));

  Array.from(sessions.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      sessions.delete(id);
      clientToResolve.delete(id);
      clientToSessionPromise.delete(id);
    }
  });
}

function setSession(clientId: string, accessToken: unknown, baseUrl: unknown) {
  if (typeof accessToken === 'string' && typeof baseUrl === 'string') {
    const previousSession = persistedSession ?? sessions.get(clientId);
    const session = { accessToken, baseUrl };
    sessions.set(clientId, session);
    persistedSession = session;
    persistSession(session).catch(() => undefined);

    if (
      previousSession &&
      (previousSession.accessToken !== accessToken || previousSession.baseUrl !== baseUrl)
    ) {
      clearMediaCache().catch(() => undefined);
    }
  } else {
    // Logout or invalid session
    sessions.delete(clientId);
    persistedSession = undefined;
    clearPersistedSession().catch(() => undefined);
    clearMediaCache().catch(() => undefined);
  }

  const resolveSession = clientToResolve.get(clientId);
  if (resolveSession) {
    resolveSession(sessions.get(clientId));
    clientToResolve.delete(clientId);
    clientToSessionPromise.delete(clientId);
  }
}

function requestSession(client: Client): Promise<SessionInfo | undefined> {
  const promise =
    clientToSessionPromise.get(client.id) ??
    new Promise((resolve) => {
      clientToResolve.set(client.id, resolve);
      client.postMessage({ type: 'requestSession' });
    });

  if (!clientToSessionPromise.has(client.id)) {
    clientToSessionPromise.set(client.id, promise);
  }

  return promise;
}

async function requestSessionWithTimeout(
  clientId: string,
  timeoutMs = 3000
): Promise<SessionInfo | undefined> {
  const client = await self.clients.get(clientId);
  if (!client) return undefined;

  const sessionPromise = requestSession(client);

  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), timeoutMs);
  });

  return Promise.race([sessionPromise, timeout]);
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await cleanupDeadClients();
      persistedSession = await loadPersistedSession();

      const windowClients = await self.clients.matchAll({ type: 'window' });
      windowClients.forEach((client) => client.postMessage({ type: 'requestSession' }));
    })()
  );
});

/**
 * Receive session updates from clients
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const client = event.source as Client | null;
  if (!client) return;

  const { type, accessToken, baseUrl } = event.data || {};

  if (type === 'setSession') {
    setSession(client.id, accessToken, baseUrl);
    event.waitUntil(cleanupDeadClients());
  }
});

const MEDIA_PATHS = [
  '/_matrix/client/v1/media/download',
  '/_matrix/client/v1/media/thumbnail',
  '/_matrix/media/v3/download',
  '/_matrix/media/v3/thumbnail',
  '/_matrix/media/r0/download',
  '/_matrix/media/r0/thumbnail',
];

function mediaPath(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return MEDIA_PATHS.some((p) => pathname.startsWith(p));
  } catch {
    return false;
  }
}

function validMediaRequest(url: string, baseUrl: string): boolean {
  return MEDIA_PATHS.some((p) => {
    const validUrl = new URL(p, baseUrl);
    return url.startsWith(validUrl.href);
  });
}

function fetchConfig(token: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'default',
  };
}

async function getPersistedSession(): Promise<SessionInfo | undefined> {
  if (persistedSession) return persistedSession;

  const session = await loadPersistedSession();
  if (session) {
    persistedSession = session;
  }

  return session;
}

async function fetchMediaWithSession(url: string, session: SessionInfo): Promise<Response> {
  return fetch(url, {
    ...fetchConfig(session.accessToken),
    redirect: 'follow',
  });
}

self.addEventListener('fetch', (event: FetchEvent) => {
  const { url, method } = event.request;

  if (method !== 'GET' || !mediaPath(url)) return;

  const { clientId } = event;

  const session = clientId ? sessions.get(clientId) : undefined;
  if (session && validMediaRequest(url, session.baseUrl)) {
    event.respondWith(
      (async () => {
        const cachedResponse = await getCachedMediaResponse(url);
        if (cachedResponse) {
          return cachedResponse;
        }

        const response = await fetchMediaWithSession(url, session);
        await cacheMediaResponse(url, response);
        return response;
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cachedResponse = await getCachedMediaResponse(url);
      if (cachedResponse) {
        return cachedResponse;
      }

      const cachedSession = await getPersistedSession();
      if (cachedSession && validMediaRequest(url, cachedSession.baseUrl)) {
        const response = await fetchMediaWithSession(url, cachedSession);
        await cacheMediaResponse(url, response);
        return response;
      }

      if (!clientId) {
        return fetch(event.request);
      }

      const requestedSession = await requestSessionWithTimeout(clientId);
      if (requestedSession && validMediaRequest(url, requestedSession.baseUrl)) {
        const response = await fetchMediaWithSession(url, requestedSession);
        await cacheMediaResponse(url, response);
        return response;
      }

      const fallbackSession = await getPersistedSession();
      if (fallbackSession && validMediaRequest(url, fallbackSession.baseUrl)) {
        const response = await fetchMediaWithSession(url, fallbackSession);
        await cacheMediaResponse(url, response);
        return response;
      }

      return fetch(event.request);
    })()
  );
});

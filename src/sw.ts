/// <reference lib="WebWorker" />

export type {};
declare const self: ServiceWorkerGlobalScope;

type SessionInfo = {
  accessToken: string;
  baseUrl: string;
};

const SW_SESSION_CACHE = 'cinny-sw-session-v1';
const SW_SESSION_URL = '/sw-session-meta';

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
    const session = { accessToken, baseUrl };
    sessions.set(clientId, session);
    persistedSession = session;
    persistSession(session).catch(() => undefined);
  } else {
    // Logout or invalid session
    sessions.delete(clientId);
    persistedSession = undefined;
    clearPersistedSession().catch(() => undefined);
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

self.addEventListener('fetch', (event: FetchEvent) => {
  const { url, method } = event.request;

  if (method !== 'GET' || !mediaPath(url)) return;

  const { clientId } = event;

  const session = clientId ? sessions.get(clientId) : undefined;
  if (session && validMediaRequest(url, session.baseUrl)) {
    event.respondWith(fetch(url, fetchConfig(session.accessToken)));
    return;
  }

  event.respondWith(
    (async () => {
      const cachedSession = await getPersistedSession();
      if (cachedSession && validMediaRequest(url, cachedSession.baseUrl)) {
        return fetch(url, fetchConfig(cachedSession.accessToken));
      }

      if (!clientId) {
        return fetch(event.request);
      }

      const requestedSession = await requestSessionWithTimeout(clientId);
      if (requestedSession && validMediaRequest(url, requestedSession.baseUrl)) {
        return fetch(url, fetchConfig(requestedSession.accessToken));
      }

      const fallbackSession = await getPersistedSession();
      if (fallbackSession && validMediaRequest(url, fallbackSession.baseUrl)) {
        return fetch(url, fetchConfig(fallbackSession.accessToken));
      }

      return fetch(event.request);
    })()
  );
});

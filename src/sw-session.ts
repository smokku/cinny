export type SWSessionPayload = {
  baseUrl: string;
  accessToken: string;
};

/**
 * Push session(s) to the service worker for authenticated media requests.
 * Accepts a single session (legacy) or an array of sessions (multi-account).
 */
export function pushSessionToSW(
  baseUrlOrSessions?: string | SWSessionPayload[],
  accessToken?: string
) {
  if (!('serviceWorker' in navigator)) return;

  let message: Record<string, unknown>;
  if (Array.isArray(baseUrlOrSessions)) {
    message = {
      type: 'setSessions',
      sessions: baseUrlOrSessions,
    };
  } else {
    // Legacy single-session path
    message = {
      type: 'setSession',
      accessToken,
      baseUrl: baseUrlOrSessions,
    };
  }

  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
    return;
  }

  navigator.serviceWorker.ready
    .then((registration) => {
      registration.active?.postMessage(message);
    })
    .catch(() => undefined);
}

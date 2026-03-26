export function pushSessionToSW(baseUrl?: string, accessToken?: string) {
  if (!('serviceWorker' in navigator)) return;

  const message = {
    type: 'setSession',
    accessToken,
    baseUrl,
  };

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

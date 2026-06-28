// register the service worker so the app shell loads with no network
if ('serviceWorker' in navigator) {
  addEventListener('load', () =>
    navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* Generated from scripts/service-worker-template.js. Do not edit build output. */
const SHELL_CACHE = '__SHELL_CACHE__';
const SHELL_CACHE_PREFIX = 'mcilroy-shell-';
const TRANSFER_CACHE = 'mcilroy-incoming-transfer';
const RELEASE_METADATA_CACHE = 'mcilroy-release-metadata';
const ACTIVE_RELEASE_KEY = '/__mcilroy-active-shell';
const PRECACHE_URLS = __PRECACHE_URLS__;
const PRECACHE_PATHS = new Set(PRECACHE_URLS.map(value => new URL(value, self.location.origin).pathname));
const INCOMING_TRANSFER_URL = '/incoming-transfer';

self.addEventListener('install', event => {
  // A release becomes installable only after its complete immutable shell is present.
  // Never add skipWaiting here: the current release must remain active until the user opts in.
  event.waitUntil(caches.open(SHELL_CACHE)
    .then(cache => cache.addAll(PRECACHE_URLS))
    .catch(async error => {
      await caches.delete(SHELL_CACHE);
      throw error;
    }));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const metadata = await caches.open(RELEASE_METADATA_CACHE);
    const previousResponse = await metadata.match(ACTIVE_RELEASE_KEY);
    const previousShell = previousResponse ? await previousResponse.text() : null;
    await metadata.put(ACTIVE_RELEASE_KEY, new Response(SHELL_CACHE));
    // Delete only the release this worker actually supersedes. Another release
    // may already be installing/waiting and its complete cache must survive this
    // activation even though ServiceWorkerRegistration cannot expose it here.
    if (previousShell && previousShell.startsWith(SHELL_CACHE_PREFIX) && previousShell !== SHELL_CACHE) {
      await caches.delete(previousShell);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  // Activation is part of the user-requested update action. Extend the message
  // lifetime so browsers cannot terminate this worker before the request lands.
  if (event.data === 'skip-waiting') event.waitUntil(self.skipWaiting());
});

const isCacheableRuntimeResponse = response => (
  response.ok && response.type === 'basic' && !response.redirected
);

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.method === 'POST' && url.pathname === '/receive-transfer') {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const file = formData.get('transfer');
      if (!file || typeof file.text !== 'function') return Response.redirect('/?transfer-error=1', 303);
      const incoming = JSON.stringify({
        name: file.name || 'mcilroy-method-transfer.txt',
        contents: await file.text(),
      });
      // Incoming transfers survive shell activation and old-release cleanup.
      const cache = await caches.open(TRANSFER_CACHE);
      await cache.put(INCOMING_TRANSFER_URL, new Response(incoming, {
        headers: { 'Content-Type': 'application/json' },
      }));
      return Response.redirect('/?incoming-transfer=1', 303);
    })());
    return;
  }

  if (event.request.method !== 'GET') return;

  if (url.pathname === INCOMING_TRANSFER_URL) {
    event.respondWith((async () => {
      const cache = await caches.open(TRANSFER_CACHE);
      const response = await cache.match(INCOMING_TRANSFER_URL);
      if (response) await cache.delete(INCOMING_TRANSFER_URL);
      return response || new Response('', { status: 404 });
    })());
    return;
  }

  if (event.request.mode === 'navigate') {
    // The active release's index is immutable. Network HTML must never mix a new
    // entry document with the active worker's old hashed chunks.
    event.respondWith(caches.open(SHELL_CACHE).then(cache => cache.match('/index.html')));
    return;
  }

  if (PRECACHE_PATHS.has(url.pathname)) {
    event.respondWith(caches.open(SHELL_CACHE).then(async cache => (
      (await cache.match(event.request)) || fetch(event.request)
    )));
    return;
  }

  if (!['script', 'style', 'font', 'image'].includes(event.request.destination)) return;

  const networkResponse = fetch(event.request);
  const cacheWrite = networkResponse.then(async response => {
    if (isCacheableRuntimeResponse(response)) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(event.request, response.clone());
    }
  }).catch(() => {});
  event.waitUntil(cacheWrite);
  event.respondWith(networkResponse);
});

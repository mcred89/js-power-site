const CACHE_NAME = 'mcilroy-method-v2';
const APP_SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];
const INCOMING_TRANSFER_URL = '/incoming-transfer';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

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
      const cache = await caches.open(CACHE_NAME);
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
      const cache = await caches.open(CACHE_NAME);
      const response = await cache.match(INCOMING_TRANSFER_URL);
      if (response) await cache.delete(INCOMING_TRANSFER_URL);
      return response || new Response('', { status: 404 });
    })());
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});

const CACHE_NAME = 'cove-v1';
const STATIC_ASSETS = [
    '/',
    '/manifest.json',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: network-first with cache fallback for navigation
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Skip non-GET and cross-origin requests
    if (request.method !== 'GET') return;
    if (!request.url.startsWith(self.location.origin)) return;

    event.respondWith(
        fetch(request)
            .then((response) => {
                // Clone and cache successful responses
                if (response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                }
                return response;
            })
            .catch(() => caches.match(request))
    );
});

// Push notification support
self.addEventListener('push', (event) => {
    const data = event.data?.json() || { title: 'Cove', body: 'New message received' };
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: 'https://image2url.com/r2/default/images/1771570994422-1886044a-26e3-4ab8-be8e-3e38f6b5af80.png',
            badge: 'https://image2url.com/r2/default/images/1771570994422-1886044a-26e3-4ab8-be8e-3e38f6b5af80.png',
            tag: 'cove-message',
            renotify: true,
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then((clients) => {
            if (clients.length > 0) {
                clients[0].focus();
            } else {
                self.clients.openWindow('/');
            }
        })
    );
});

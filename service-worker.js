// service-worker.js (improved)
// - Versioned cache name to force updates on deployment
// - Resilient install (Promise.allSettled), network-first for navigations, cache-first for static assets
// - Avoid caching requests with auth or non-GET (sensitive / dynamic requests)
// - Runtime cache for Google fonts, Cloudinary images with size limits
// - Responds to 'SKIP_WAITING' message to activate immediately

const CACHE_VERSION = 'v2025-09-09-1';
const STATIC_CACHE = `presensi-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `presensi-runtime-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/karyawan.html',
  '/admin.html',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-icon-512.png'
];

// Hosts we may cache at runtime (cache-first)
const RUNTIME_HOST_WHITELIST = [
  'res.cloudinary.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net'
];

async function trimCache(cacheName, maxEntries = 100) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    try {
      const results = await Promise.allSettled(PRECACHE_ASSETS.map(url => cache.add(url)));
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length) {
        console.warn('SW precache partial failures:', failures.map(f => f.reason && f.reason.message));
      }
    } catch (e) {
      console.warn('SW install cache.addAll failed: ', e);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (![STATIC_CACHE, RUNTIME_CACHE].includes(k)) {
        return caches.delete(k);
      }
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

function isSameOrigin(requestUrl) {
  try {
    const req = new URL(requestUrl);
    return req.origin === self.location.origin;
  } catch (e) {
    return false;
  }
}

function isRuntimeHost(url) {
  try {
    const u = new URL(url);
    return RUNTIME_HOST_WHITELIST.includes(u.host);
  } catch (e) {
    return false;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') {
    return event.respondWith(fetch(req));
  }

  const url = req.url;
  const forbiddenPatterns = ['firestore.googleapis.com', 'googleapis.com', 'firebaseio.com', 'gstatic.com/identity'];
  if (req.headers.has('authorization') || forbiddenPatterns.some(p => url.includes(p))) {
    return event.respondWith(fetch(req));
  }

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(req);
        const cache = await caches.open(STATIC_CACHE);
        try { cache.put(req, networkResponse.clone()); } catch (e) { }
        return networkResponse;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fallback = await caches.match('/index.html');
        return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  if (isRuntimeHost(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) {
          try { cache.put(req, resp.clone()); } catch (e) { }
          trimCache(RUNTIME_CACHE, 200).catch(()=>{});
        }
        return resp;
      } catch (e) {
        return cached || new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })());
    return;
  }

  if (isSameOrigin(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) {
          try { cache.put(req, resp.clone()); } catch (e) { }
        }
        return resp;
      } catch (err) {
        return cached || new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const resp = await fetch(req);
      return resp;
    } catch (e) {
      return caches.match(req).then(m => m || new Response('', { status: 504, statusText: 'Offline' }));
    }
  })());
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  try {
    const payload = event.data ? event.data.json() : { title: 'Presensi FUPA', body: 'Ada notifikasi baru' };
    const title = payload.title || 'Presensi FUPA';
    const options = {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: payload.data || {}
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    console.warn('push handler error', e);
  }
});

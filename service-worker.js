// service-worker.js — cache dasar untuk shell offline dengan update untuk mendukung fitur notifikasi
const CACHE = "presensi-fupa-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./karyawan.html",
  "./admin.html",
  "./app.js",
  "./manifest.webmanifest",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap",
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:FILL,GRAD@1,200"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Network first untuk HTML, cache first untuk lainnya
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(m => m || caches.match("./index.html")))
    );
  } else {
    e.respondWith(
      caches.match(req).then(m => m || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }))
    );
  }
});

// Background sync untuk notifikasi
self.addEventListener('sync', (event) => {
  if (event.tag === 'notif-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Implementasi background sync untuk notifikasi
  // Di sini kita bisa menambahkan logika untuk mengirim notifikasi
  // bahkan ketika aplikasi tidak sedang dibuka
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'background-sync',
      message: 'Aplikasi Presensi FUPA sedang berjalan di latar belakang'
    });
  });
}

// Push notifications
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: 'https://api.iconify.design/material-symbols/workspace-premium.svg?color=%23ffb300',
      badge: 'https://api.iconify.design/material-symbols/workspace-premium.svg?color=%23ffb300',
      vibrate: [200, 100, 200],
      tag: 'presensi-notification'
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({type: 'window'}).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('/');
    })
  );
});
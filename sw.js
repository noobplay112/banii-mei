// Service worker: aplicația merge offline și poate trimite memento-ul pentru cash.
const CACHE = 'banii-mei-v2';
const FILES = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/db.js', './js/categories.js', './js/xlsx.js', './js/import.js', './js/pdf.js',
  './vendor/pdf.min.js', './vendor/pdf.worker.min.js',
  './js/stats.js', './js/charts.js', './js/app.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rețea întâi (ca să vezi mereu ultima versiune), cache dacă ești offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Citește din IndexedDB când a fost ultima dată introdus cash-ul.
function readCashState() {
  return new Promise((resolve) => {
    const req = indexedDB.open('banii-mei');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cash') || !db.objectStoreNames.contains('settings')) return resolve(null);
      const tx = db.transaction(['cash', 'settings'], 'readonly');
      const all = tx.objectStore('cash').getAll();
      const days = tx.objectStore('settings').get('remindDays');
      tx.oncomplete = () => {
        const last = all.result.reduce((m, c) => (c.date > m ? c.date : m), '');
        resolve({ last, days: (days.result && days.result.value) || 3 });
      };
      tx.onerror = () => resolve(null);
    };
  });
}

async function maybeRemind() {
  const s = await readCashState();
  if (!s) return;
  const due = !s.last || (Date.now() - new Date(s.last).getTime()) / 86400000 >= s.days;
  if (due) {
    await self.registration.showNotification('Câți bani ai cash?', {
      body: 'Deschide Banii Mei și spune suma, durează 5 secunde.',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'cash-reminder',
      data: { url: './index.html#cash-ask' }
    });
  }
}

// Chrome pe Android rulează asta periodic pentru aplicațiile instalate.
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'cash-reminder') e.waitUntil(maybeRemind());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(url); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});

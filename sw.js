/* Service Worker — Calisthenics Tracker
 * Estrategia: precache del "app shell" + cache-first. Funciona 100% offline.
 * IMPORTANTE: al cambiar CUALQUIER archivo de la lista, sube VERSION (v1 -> v2...)
 * para que los móviles descarguen la versión nueva. Los datos (IndexedDB) NO se tocan.
 */
const VERSION = 'v16';
const CACHE = `calistenia-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/stats.js',
  'js/chart.js',
  'js/util.js',
  'js/biblioteca.js',
  'js/sync.js',
  'js/syncCore.js',
  'js/resumen.js',
  'js/zonas.js',
  'js/firebase-config.js',
  'vendor/firebase.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL))
    // No hacemos skipWaiting automático: la app avisa y el usuario decide cuándo recargar
    // (así nunca se refresca la pantalla en mitad de una serie).
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('calistenia-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});

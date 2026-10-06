export const CACHE_PREFIX = 'el-rancho-shell-';
export const PRIVATE_CACHE_PREFIXES = ['el-rancho-data-', 'sistema-ganadero-data-'];
export const BLOCKED_PATHS = ['/api', '/uploads'];
export const NAVEGACION_TIMEOUT_MS = 3000;

export function isAllowedPrecachePath(pathname) {
  if (BLOCKED_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  return pathname === '/index.html'
    || pathname === '/manifest.webmanifest'
    || /^\/icons\/[a-z0-9._-]+\.(?:png|svg)$/i.test(pathname)
    || /^\/assets\/[a-z0-9._-]+\.(?:js|css|png|svg|webp|woff2?)$/i.test(pathname);
}
export function renderServiceWorker({ version, resources }) {
  const allowed = [...new Set(resources)].filter(isAllowedPrecachePath).sort();
  return `/* El Rancho: shell estático; nunca almacena datos operativos. */
const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(version)};
const PRIVATE_CACHE_PREFIXES = ${JSON.stringify(PRIVATE_CACHE_PREFIXES)};
const BLOCKED_PATHS = ${JSON.stringify(BLOCKED_PATHS)};
const PRECACHE_URLS = ${JSON.stringify(allowed, null, 2)};
const PRECACHE_PATHS = new Set(PRECACHE_URLS);

function isBlocked(request, url) {
  return request.method !== 'GET'
    || url.origin !== self.location.origin
    || request.headers.has('authorization')
    || BLOCKED_PATHS.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix + '/'));
}

// Navegación: red primero para recibir versiones nuevas, pero con límite de
// ${NAVEGACION_TIMEOUT_MS} ms. Sin él, un celular fuera del hotspot de la laptop
// (con otra red) esperaría el timeout TCP antes de abrir la app guardada.
async function navegar(request) {
  const cache = await caches.open(CACHE_NAME);
  const guardada = await cache.match('/index.html');
  const red = fetch(request).catch(() => null);
  if (!guardada) return (await red) || Response.error();
  const limite = new Promise((resolve) => setTimeout(() => resolve(null), ${NAVEGACION_TIMEOUT_MS}));
  return (await Promise.race([red, limite])) || guardada;
}
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      || PRIVATE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (isBlocked(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(navegar(request));
    return;
  }

  if (!PRECACHE_PATHS.has(url.pathname)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) =>
    (await cache.match(url.pathname)) || fetch(request)));
});

self.addEventListener('message', (event) => {
  if (event.data?.tipo === 'ACTIVAR_VERSION') self.skipWaiting();
  if (event.data?.tipo === 'LIMPIAR_CACHES_PRIVADOS') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys
      .filter((key) => PRIVATE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
      .map((key) => caches.delete(key)))));
  }
});
`;
}

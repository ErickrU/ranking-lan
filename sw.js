/* ==========================================================================
   Ranking LAN · Service Worker
   --------------------------------------------------------------------------
   Estrategias por tipo de peticion:

     navegacion        -> network-first  -> cache(index.html) -> offline.html
     /api/ranking      -> network-first  -> cache (marcada con X-Ranking-Origen)
     datos/*.json      -> stale-while-revalidate
     app shell (css/js/iconos/manifest)
                       -> cache-first + revalidacion en segundo plano
     resto same-origin -> network con respaldo de cache

   Sube VERSION para invalidar los caches viejos en el siguiente despliegue.
   ========================================================================== */

const VERSION = 'v2';
const CACHE_SHELL = `ranking-lan-shell-${VERSION}`;
const CACHE_DATOS = 'ranking-lan-datos-v1'; // compartido con js/api.js
const CACHES_VIGENTES = new Set([CACHE_SHELL, CACHE_DATOS]);

/** App shell: lo minimo para que la app abra sin red. */
const PRECACHE = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './css/estilos.css',
  './js/app.js',
  './js/api.js',
  './js/ui.js',
  './js/registro-sw.js',
  './js/amigos.js',
  './datos/ranking-lan.json',
  './iconos/favicon.svg',
  './iconos/icono-192.png',
  './iconos/icono-512.png',
  './iconos/icono-maskable-512.png',
  './iconos/apple-touch-icon.png',
];

const absoluta = (ruta) => new URL(ruta, self.registration.scope).toString();

/* ==========================================================================
   INSTALL · precache tolerante a fallos
   ========================================================================== */
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);

      // addAll falla en bloque si un solo recurso da error; lo hacemos uno a uno
      // para que un archivo ausente no impida instalar el service worker.
      const resultados = await Promise.allSettled(
        PRECACHE.map(async (ruta) => {
          const peticion = new Request(absoluta(ruta), { cache: 'reload' });
          const respuesta = await fetch(peticion);
          if (!respuesta.ok) throw new Error(`${ruta} -> ${respuesta.status}`);
          await cache.put(peticion, respuesta);
        }),
      );

      const fallos = resultados.filter((r) => r.status === 'rejected');
      if (fallos.length > 0) {
        console.warn('[SW] recursos no precacheados:', fallos.map((f) => f.reason?.message));
      }
    })(),
  );
});

/* ==========================================================================
   ACTIVATE · limpieza de caches antiguos
   ========================================================================== */
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres
          .filter((nombre) => nombre.startsWith('ranking-lan-') && !CACHES_VIGENTES.has(nombre))
          .map((nombre) => caches.delete(nombre)),
      );

      // Acelera la primera respuesta en navegadores que lo soportan.
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch { /* opcional */ }
      }

      await self.clients.claim();
    })(),
  );
});

/* ==========================================================================
   MESSAGE · la pagina pide activar la version nueva
   ========================================================================== */
self.addEventListener('message', (evento) => {
  if (evento.data?.tipo === 'SALTAR_ESPERA') self.skipWaiting();
});

/* ==========================================================================
   Helpers
   ========================================================================== */

/** Copia una respuesta añadiendo la marca de que vino de la cache. */
async function marcarComoCache(respuesta) {
  const cabeceras = new Headers(respuesta.headers);
  cabeceras.set('X-Ranking-Origen', 'cache');
  return new Response(await respuesta.arrayBuffer(), {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers: cabeceras,
  });
}

/** Guarda en cache solo respuestas utiles (200 y del mismo origen). */
function esGuardable(respuesta) {
  return respuesta && respuesta.ok && respuesta.type !== 'opaque';
}

/* --------------------------- network-first ------------------------------- */
async function redPrimero(peticion, nombreCache) {
  const cache = await caches.open(nombreCache);
  try {
    const respuesta = await fetch(peticion);
    if (esGuardable(respuesta)) cache.put(peticion, respuesta.clone());
    return respuesta;
  } catch (error) {
    const guardada = await cache.match(peticion);
    if (guardada) return marcarComoCache(guardada);
    throw error;
  }
}

/* --------------------------- cache-first -------------------------------- */
async function cachePrimero(peticion, nombreCache) {
  const cache = await caches.open(nombreCache);
  const guardada = await cache.match(peticion);

  if (guardada) {
    // Revalidamos en segundo plano para la proxima visita.
    fetch(peticion)
      .then((respuesta) => { if (esGuardable(respuesta)) cache.put(peticion, respuesta); })
      .catch(() => {});
    return guardada;
  }

  const respuesta = await fetch(peticion);
  if (esGuardable(respuesta)) cache.put(peticion, respuesta.clone());
  return respuesta;
}

/* ------------------- stale-while-revalidate ----------------------------- */
async function caducoMientrasRevalida(peticion, nombreCache) {
  const cache = await caches.open(nombreCache);
  const guardada = await cache.match(peticion);

  const enRed = fetch(peticion)
    .then((respuesta) => {
      if (esGuardable(respuesta)) cache.put(peticion, respuesta.clone());
      return respuesta;
    })
    .catch(() => null);

  if (guardada) return guardada;

  const respuesta = await enRed;
  if (respuesta) return respuesta;
  throw new Error('Sin red y sin copia en cache');
}

/* --------------------------- navegacion --------------------------------- */
async function navegacion(evento) {
  const cache = await caches.open(CACHE_SHELL);
  try {
    const respuesta = (await evento.preloadResponse) || (await fetch(evento.request));
    if (esGuardable(respuesta)) cache.put(evento.request, respuesta.clone());
    return respuesta;
  } catch {
    return (
      (await cache.match(evento.request)) ||
      (await cache.match(absoluta('./index.html'))) ||
      (await cache.match(absoluta('./'))) ||
      (await cache.match(absoluta('./offline.html'))) ||
      new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    );
  }
}

/* ==========================================================================
   FETCH · enrutado
   ========================================================================== */
self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;

  // Solo GET: las escrituras nunca se cachean.
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);

  // Dejamos pasar lo que no es de nuestro origen (p. ej. enlaces externos).
  if (url.origin !== self.location.origin) return;

  // 1. Navegaciones
  if (peticion.mode === 'navigate') {
    evento.respondWith(navegacion(evento));
    return;
  }

  // 2. El proxy de la API de Riot (ranking global y jugadores del grupo):
  //    siempre lo mas fresco posible, con la ultima copia como respaldo.
  if (url.pathname.includes('/api/')) {
    evento.respondWith(redPrimero(peticion, CACHE_DATOS));
    return;
  }

  // 3. Semilla de datos: rapida desde cache, se actualiza detras.
  if (url.pathname.endsWith('.json')) {
    evento.respondWith(caducoMientrasRevalida(peticion, CACHE_SHELL));
    return;
  }

  // 4. App shell.
  if (/\.(?:css|js|mjs|svg|png|webp|woff2?|webmanifest)$/.test(url.pathname)) {
    evento.respondWith(cachePrimero(peticion, CACHE_SHELL));
    return;
  }

  // 5. Resto: red con respaldo de cache.
  evento.respondWith(redPrimero(peticion, CACHE_SHELL));
});

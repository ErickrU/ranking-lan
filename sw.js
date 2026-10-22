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

   Ademas implementa el widget "Top 3 LAN" para el panel de widgets de
   Windows 11 (Edge PWA Widgets) y atiende al simulador de la pagina; ver el
   bloque WIDGETS al final.

   Sube VERSION para invalidar los caches viejos en el siguiente despliegue.
   ========================================================================== */

const VERSION = 'v8';
const CACHE_SHELL = `ranking-lan-shell-${VERSION}`;
const CACHE_DATOS = 'ranking-lan-datos-v1'; // compartido con js/api.js
const CACHE_DDRAGON = 'ranking-lan-ddragon-v1'; // retratos e indice de campeones
const CACHE_WIDGETS = 'ranking-lan-widgets-v1'; // ultimo estado difundido del widget
const CACHES_VIGENTES = new Set([CACHE_SHELL, CACHE_DATOS, CACHE_DDRAGON, CACHE_WIDGETS]);

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
  './js/i18n.js',
  './js/campeones.js',
  './js/widgets.js',
  './widgets/top3-lan-plantilla.json',
  './widgets/top3-lan-datos.json',
  './widgets/top3-lan-captura.png',
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

      // Widgets ya instalados en el panel de Windows: repintarlos con la
      // version nueva para que no queden vacios. Nunca bloquea la activacion.
      if ('widgets' in self) {
        try { await updateWidgets(); } catch (error) { console.warn('[SW] widgets', error); }
      }
    })(),
  );
});

/* ==========================================================================
   MESSAGE · la pagina pide activar la version nueva o habla con el widget
   ========================================================================== */
self.addEventListener('message', (evento) => {
  const mensaje = evento.data;
  if (!mensaje || typeof mensaje !== 'object') return;

  if (mensaje.tipo === 'SALTAR_ESPERA') {
    self.skipWaiting();
    return;
  }

  // Mensajes del simulador del panel de widgets (js/widgets.js). Solo se
  // atiende el tag propio; cualquier otro se ignora en silencio.
  if (typeof mensaje.tag !== 'string' || !TAG_VALIDO.test(mensaje.tag) || mensaje.tag !== TAG_WIDGET) return;
  if (mensaje.tipo === 'WIDGET_DATOS') evento.waitUntil(recibirDatosWidget(mensaje.tag, mensaje.datos));
  else if (mensaje.tipo === 'WIDGET_ACCION') evento.waitUntil(manejarAccionWidget(mensaje.tag, mensaje.verb));
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

  // Data Dragon (retratos de campeon, iconos, indice de campeones): assets
  // estaticos y publicos de Riot, inmutables por version de parche. Se sirven
  // cache-first para que las fichas del grupo funcionen offline tras la
  // primera visita. Es el UNICO origen externo que toca el service worker.
  if (url.origin === 'https://ddragon.leagueoflegends.com') {
    evento.respondWith(cachePrimero(peticion, CACHE_DDRAGON));
    return;
  }

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

/* ==========================================================================
   WIDGETS · Edge PWA Widgets (panel de widgets de Windows 11)
   --------------------------------------------------------------------------
   El manifest declara el widget "top3-lan": una plantilla de Adaptive Card
   (widgets/top3-lan-plantilla.json) y sus datos por defecto. En Windows 11 el
   host avisa a este service worker con widgetinstall / widgetresume /
   widgetclick y aqui se pinta con self.widgets.updateByTag. El simulador de
   la pagina (js/widgets.js) habla con este mismo bloque por postMessage, asi
   que plantilla, datos y verbos son identicos en Windows y en el simulador.

   Datos: el proxy (/api/ranking) es la fuente preferida; sin red se usa la
   ultima copia del proxy, luego el ultimo estado difundido y, al final, el
   JSON estatico del paquete.
   ========================================================================== */
const TAG_WIDGET = 'top3-lan';
const TAG_VALIDO = /^[a-z0-9-]+$/;
// Mismo orden de parametros que urlProxy() en js/api.js: asi la entrada de
// CACHE_DATOS es la misma que guarda la pagina.
const URL_RANKING_WIDGET = './api/ranking?region=la1&cola=RANKED_SOLO_5x5&tier=CHALLENGER&division=I';
const FUENTE_TEXTO = { demo: 'Datos de demostración', cache: 'Desde caché', vivo: 'Datos en vivo' };

/** Ultimos datos difundidos por tag (memoria; Cache Storage como respaldo). */
const datosWidgets = new Map();
/** URL sintetica bajo la que se guarda el estado del widget en CACHE_WIDGETS. */
const claveEstado = (tag) => absoluta(`./widgets/${tag}-estado.json`);

async function guardarDatosWidget(tag, datos) {
  datosWidgets.set(tag, datos);
  try {
    const cache = await caches.open(CACHE_WIDGETS);
    await cache.put(
      claveEstado(tag),
      new Response(JSON.stringify(datos), { headers: { 'Content-Type': 'application/json' } }),
    );
  } catch { /* cuota llena: la copia en memoria basta */ }
}

async function leerDatosGuardados(tag) {
  if (datosWidgets.has(tag)) return datosWidgets.get(tag);
  try {
    const guardada = await caches.match(claveEstado(tag));
    if (guardada) {
      const datos = await guardada.json();
      datosWidgets.set(tag, datos);
      return datos;
    }
  } catch { /* copia ilegible */ }
  return null;
}

/** Lee un recurso del paquete: primero la cache del app shell, despues la red. */
async function recursoDelPaquete(ruta) {
  const url = absoluta(ruta);
  const respuesta = (await caches.match(url)) ?? (await fetch(url));
  if (!respuesta.ok) throw new Error(`${ruta} -> ${respuesta.status}`);
  return respuesta;
}

async function obtenerDatosEstaticos(tag, urlDatos = `./widgets/${tag}-datos.json`) {
  return (await recursoDelPaquete(urlDatos)).json();
}

async function obtenerPlantillaWidget(urlPlantilla = `./widgets/${TAG_WIDGET}-plantilla.json`) {
  return (await recursoDelPaquete(urlPlantilla)).text();
}

/** Convierte un listado del proxy en los datos que espera la plantilla. */
function datosDesdeListado(listado, origen) {
  const fuente = listado.fuente === 'demo' ? 'demo' : origen === 'cache' ? 'cache' : 'vivo';
  const lista = Array.isArray(listado.jugadores) ? listado.jugadores : [];
  const jugadores = [];
  for (let i = 0; i < 3; i++) {
    const j = lista[i];
    jugadores.push(j
      ? {
        puesto: j.puesto ?? i + 1,
        riotId: j.riotId || 'Nombre pendiente',
        lp: j.lp ?? 0,
        victorias: j.victorias ?? 0,
        derrotas: j.derrotas ?? 0,
      }
      : { puesto: i + 1, riotId: '—', lp: 0, victorias: 0, derrotas: 0 });
  }
  const actualizado = listado.actualizado ?? null;
  const fecha = actualizado ? new Date(actualizado) : null;
  return {
    region: 'LAN',
    liga: 'Retador',
    cola: 'Solo/Dúo',
    fuente,
    fuenteTexto: FUENTE_TEXTO[fuente],
    actualizado,
    actualizadoTexto: fecha && !Number.isNaN(fecha.getTime())
      ? fecha.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
      : 'sin fecha',
    jugadores,
    urlApp: './?tier=CHALLENGER&cola=RANKED_SOLO_5x5',
  };
}

/** Datos del widget: proxy -> copia del proxy -> ultimo estado -> JSON estatico. */
async function obtenerDatosWidget(tag, urlDatos) {
  const url = absoluta(URL_RANKING_WIDGET);

  // 1. Red. La copia se guarda en CACHE_DATOS, la misma entrada que usa la pagina.
  try {
    const respuesta = await fetch(url, { headers: { Accept: 'application/json' } });
    if (respuesta.ok) {
      const cache = await caches.open(CACHE_DATOS);
      await cache.put(url, respuesta.clone());
      const datos = datosDesdeListado(await respuesta.json(), 'red');
      await guardarDatosWidget(tag, datos);
      return datos;
    }
  } catch { /* sin red: seguimos con las copias */ }

  // 2. Ultima respuesta buena del proxy.
  try {
    const guardada = await (await caches.open(CACHE_DATOS)).match(url);
    if (guardada) return datosDesdeListado(await guardada.json(), 'cache');
  } catch { /* copia ilegible */ }

  // 3. Ultimo estado que difundio este service worker.
  const previos = await leerDatosGuardados(tag);
  if (previos) return { ...previos, fuente: 'cache', fuenteTexto: FUENTE_TEXTO.cache };

  // 4. Datos de demostracion incluidos en el paquete.
  return obtenerDatosEstaticos(tag, urlDatos);
}

/** Las Adaptive Cards de Windows necesitan URL absolutas; la pagina recibe la relativa. */
function datosParaHost(datos) {
  return JSON.stringify({ ...datos, urlApp: absoluta(datos.urlApp ?? './') });
}

/** Repinta el widget en Windows (si existe) y avisa a todas las ventanas de la app. */
async function difundirWidget(tag, datos) {
  if ('widgets' in self) {
    try {
      await self.widgets.updateByTag(tag, { template: await obtenerPlantillaWidget(), data: datosParaHost(datos) });
    } catch (error) {
      console.warn('[SW] updateByTag', error); // el widget puede no estar instalado en el host
    }
  }
  const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const cliente of clientes) cliente.postMessage({ tipo: 'WIDGET_ACTUALIZADO', tag, datos });
}

/** WIDGET_DATOS: con datos, la pagina publica; sin datos, consulta. */
async function recibirDatosWidget(tag, datos) {
  if (datos && typeof datos === 'object' && !Array.isArray(datos)) {
    await guardarDatosWidget(tag, datos);
    await difundirWidget(tag, datos);
    return;
  }
  await difundirWidget(tag, await obtenerDatosWidget(tag));
}

/** Unica ruta para los verbos: la usan tanto widgetclick (Windows) como WIDGET_ACCION (simulador). */
async function manejarAccionWidget(tag, verb) {
  switch (verb) {
    case 'actualizar':
      await difundirWidget(tag, await obtenerDatosWidget(tag));
      break;
    default:
      console.warn('[SW] verbo de widget desconocido:', verb);
  }
}

/** Pinta una instancia del widget con la plantilla y los datos de su definicion. */
async function renderWidget(widget) {
  const { tag, msAcTemplate, data } = widget.definition;
  const template = await obtenerPlantillaWidget(msAcTemplate);
  const datos = await obtenerDatosWidget(tag, data);
  await self.widgets.updateByTag(tag, { template, data: datosParaHost(datos) });
}

/** Repinta el widget si el usuario ya lo tiene en el panel. */
async function updateWidgets() {
  const widget = await self.widgets.getByTag(TAG_WIDGET);
  if (widget) await renderWidget(widget);
}

if ('widgets' in self) {
  // Al agregar el widget desde el panel no se pinta solo: hay que renderizarlo.
  self.addEventListener('widgetinstall', (evento) => {
    evento.waitUntil(renderWidget(evento.widget));
  });
  // El host vuelve a mostrar los widgets tras suspenderlos para ahorrar recursos.
  self.addEventListener('widgetresume', (evento) => {
    evento.waitUntil(renderWidget(evento.widget));
  });
  // evento.action es el `verb` de la accion pulsada en la plantilla.
  self.addEventListener('widgetclick', (evento) => {
    evento.waitUntil(manejarAccionWidget(TAG_WIDGET, evento.action));
  });
}

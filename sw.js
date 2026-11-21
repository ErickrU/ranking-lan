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
   bloque WIDGETS.

   Y genera los avisos y distintivos de la app (Notifications API + App
   Badging, sin push): compara los datos frescos que publica la pagina (o que
   el propio SW descarga en periodicsync) con su instantanea, muestra una
   notificacion por cada cambio de "Mi grupo" o del top 3 (en el idioma de la
   app, solo si ninguna ventana tiene el foco) y actualiza el distintivo del
   icono; ver el bloque AVISOS al final.

   Instalacion en dos partes: el shell CRITICO se precachea de forma atomica en
   install (cache.addAll: o esta entero o la instalacion falla y la pagina
   vuelve a registrar el SW, ver js/registro-sw.js) y el resto del shell se
   completa en activate, por recurso y tolerando fallos. Asi el install dura lo
   minimo y un archivo ausente nunca deja una version a medias ni la tumba.

   Sube VERSION para invalidar los caches viejos en el siguiente despliegue.
   ========================================================================== */

const VERSION = 'v11';
const CACHE_SHELL = `ranking-lan-shell-${VERSION}`;
const CACHE_DATOS = 'ranking-lan-datos-v1'; // compartido con js/api.js
const CACHE_DDRAGON = 'ranking-lan-ddragon-v1'; // retratos e indice de campeones
const CACHE_WIDGETS = 'ranking-lan-widgets-v1'; // ultimo estado difundido del widget
const CACHE_AVISOS = 'ranking-lan-avisos-v1'; // config, instantanea y pendientes de los avisos
const CACHES_VIGENTES = new Set([CACHE_SHELL, CACHE_DATOS, CACHE_DDRAGON, CACHE_WIDGETS, CACHE_AVISOS]);

/**
 * App shell CRITICO: sin estos archivos la app no abre sin red. Se precachean
 * de forma atomica en install: si uno falla, la instalacion falla entera y la
 * pagina reintenta el registro (js/registro-sw.js).
 */
const PRECACHE_CRITICO = [
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
  './js/avisos.js',
];

/**
 * Resto del shell: privacidad, widget, semilla de datos e iconos. Se precachea
 * en activate, recurso a recurso y tolerando fallos (ver completarShell()): un
 * archivo ausente solo deja un aviso en consola, y el enrutado de fetch lo
 * guarda igualmente la primera vez que la pagina lo pide.
 */
const PRECACHE_OPCIONAL = [
  './privacidad.html',
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

/** Peticion de precache: siempre a la red, saltando el cache HTTP del navegador. */
const peticionPrecache = (ruta) => new Request(absoluta(ruta), { cache: 'reload' });

/**
 * Precachea PRECACHE_OPCIONAL uno a uno: solo lo que aun no esta en CACHE_SHELL
 * y solo respuestas 200. Nunca rechaza; los fallos se agrupan en un console.warn.
 */
async function completarShell() {
  const cache = await caches.open(CACHE_SHELL);
  const resultados = await Promise.allSettled(
    PRECACHE_OPCIONAL.map(async (ruta) => {
      const peticion = peticionPrecache(ruta);
      if (await cache.match(peticion)) return;
      const respuesta = await fetch(peticion);
      if (!respuesta.ok) throw new Error(`${ruta} -> ${respuesta.status}`);
      await cache.put(peticion, respuesta);
    }),
  );
  const fallos = resultados.filter((r) => r.status === 'rejected');
  if (fallos.length > 0) {
    console.warn('[SW] recursos opcionales no precacheados:', fallos.map((f) => f.reason?.message));
  }
}

/* ==========================================================================
   INSTALL · shell critico, atomico y breve
   --------------------------------------------------------------------------
   Solo el shell critico, con cache.addAll: o se guardan todos o la version no
   se instala (y la pagina vuelve a registrar el SW). Cuanto menos dure el
   install, menos expuesto queda el worker a que el navegador lo detenga a
   mitad de camino en la primera carga (lo que dejaba la version `redundant`
   y la pagina sin SW hasta la siguiente visita).
   ========================================================================== */
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);
      await cache.addAll(PRECACHE_CRITICO.map(peticionPrecache));
    })(),
  );
});

/* ==========================================================================
   ACTIVATE · limpieza de caches antiguos y resto del shell
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

  // El resto del shell va aparte para no retrasar clients.claim(): la
  // activacion nunca falla por un recurso opcional (completarShell no rechaza).
  evento.waitUntil(completarShell());
});

/* ==========================================================================
   MESSAGE · la pagina pide activar la version nueva, habla con el widget o
   con los avisos
   ========================================================================== */
self.addEventListener('message', (evento) => {
  const mensaje = evento.data;
  if (!mensaje || typeof mensaje !== 'object') return;

  if (mensaje.tipo === 'SALTAR_ESPERA') {
    self.skipWaiting();
    return;
  }

  // Mensajes de la seccion "Avisos y distintivos" (js/avisos.js); ver el
  // bloque AVISOS al final. Un fallo nunca debe quedar como rechazo sin manejar.
  // Todo lo que lee y escribe CACHE_AVISOS pasa por enCola(): un procesado a la
  // vez, en orden de llegada, para que dos mensajes casi simultaneos (o uno
  // durante un periodicsync) no se pisen la instantanea ni los pendientes.
  const atender = (tarea) => evento.waitUntil(tarea.catch((error) => console.warn('[SW] avisos', error)));
  switch (mensaje.tipo) {
    case 'AVISOS_DATOS': atender(enCola(() => recibirDatosAvisos(mensaje))); return;
    case 'AVISOS_PROBAR': atender(enCola(mostrarPrueba)); return;
    case 'AVISOS_VISTOS': atender(enCola(marcarVistos)); return;
    case 'AVISOS_SINCRONIZAR': atender(sincronizarAvisos()); return;
    case 'AVISOS_ABRIR': atender(abrirDestino(mensaje.accion === 'ranking' ? 'global' : 'grupo')); return;
    default: break;
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

/* ==========================================================================
   AVISOS · Notifications API + App Badging (guia de Microsoft Edge para PWA)
   --------------------------------------------------------------------------
   Sin servidor push: los avisos nacen aqui, comparando datos frescos con la
   ultima instantanea. La fuente de verdad es Cache Storage (CACHE_AVISOS), con
   tres entradas sinteticas que SOLO escribe este service worker:

     ./avisos/config.json       preferencia `activados`, seleccion (region,
                                cola, tier, division) y grupo {miembros, cola}
     ./avisos/instantanea.json  grupo["<region>|<cola>|<riotId minusculas>"]
                                = {tier, division, lp} y
                                ranking["<region>|<cola>|<tier>|<division>"]
                                = {top3:[{clave, riotId, lp}]}
     ./avisos/pendientes.json   {n, cambios[]} (tope MAX_CAMBIOS)

   Pagina -> SW: AVISOS_DATOS {config?, ranking?, grupo?} cada vez que app.js
   o amigos.js terminan con datos frescos; AVISOS_PROBAR, AVISOS_VISTOS,
   AVISOS_SINCRONIZAR (misma sincronizarAvisos() que periodicsync) y
   AVISOS_ABRIR {accion} (simulador del clic: misma abrirDestino() que
   notificationclick).
   SW -> todas las ventanas: AVISOS_PENDIENTES {n, cambios, badge, origen,
   nuevos, silencioso}, AVISOS_PROBADO {mostrado, badge} y AVISOS_IR {vista}.

   La config que publica la pagina describe la intencion del usuario (grupo
   completo guardado, seleccion seguida, idioma, preferencia) y aqui se
   FUSIONA con la guardada: un mensaje parcial nunca borra lo que no trae.
   Notificaciones y distintivo solo si config.activados, el permiso esta
   concedido y ninguna ventana de la app tiene el foco (con la app a la vista
   solo se actualiza la lista "Ultimos cambios"); la instantanea se actualiza
   siempre. Textos en el idioma de la app (config.idioma, 'es' | 'en').
   ========================================================================== */
const UMBRAL_LP = 20;
const MAX_MIEMBROS_AVISOS = 20;
const MAX_CAMBIOS = 20;
const MAX_RIOT_ID = 40;
const TAG_SYNC_AVISOS = 'avisos';

const ETIQUETA_REGION = {
  la1: 'LAN', la2: 'LAS', na1: 'NA', br1: 'BR', euw1: 'EUW', eun1: 'EUNE', tr1: 'TR', ru: 'RU',
  me1: 'ME', kr: 'KR', jp1: 'JP', oc1: 'OCE', sg2: 'SEA', tw2: 'TW', vn2: 'VN',
};
// Mismo orden y pesos que puntuacionRango() en js/api.js.
const ORDEN_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const VALOR_DIVISION = { I: 3, II: 2, III: 1, IV: 0 };
const TIERS_APEX = new Set(['CHALLENGER', 'GRANDMASTER', 'MASTER']);

/* --------------------------------- i18n ---------------------------------- */

// El SW no puede importar js/i18n.js (modulo ES con DOM y localStorage), asi
// que lleva su propio diccionario con el MISMO esquema de claves y la misma
// interpolacion {variable}: 'tier.*' y 'cola.*' son copia literal de js/i18n.js
// y 'avisos.notif.*' son las cadenas que solo existen aqui. Si cambias un
// texto en js/i18n.js, cambialo tambien aqui.
const IDIOMAS_SW = ['es', 'en'];
const IDIOMA_POR_DEFECTO = 'es';
const DICCIONARIOS_SW = {
  es: {
    'tier.CHALLENGER': 'Retador',
    'tier.GRANDMASTER': 'Gran Maestro',
    'tier.MASTER': 'Maestro',
    'tier.DIAMOND': 'Diamante',
    'tier.EMERALD': 'Esmeralda',
    'tier.PLATINUM': 'Platino',
    'tier.GOLD': 'Oro',
    'tier.SILVER': 'Plata',
    'tier.BRONZE': 'Bronce',
    'tier.IRON': 'Hierro',
    'tier.UNRANKED': 'Sin clasificar',
    'cola.RANKED_SOLO_5x5': 'Solo / Dúo',
    'cola.RANKED_FLEX_SR': 'Flexible',
    'avisos.notif.grupo.titulo': 'Mi grupo · Ranking LAN',
    'avisos.notif.ranking.titulo': 'Top 3 · Ranking LAN',
    'avisos.notif.prueba.titulo': 'Aviso de prueba · Ranking LAN',
    'avisos.notif.prueba.cuerpo': 'Así avisaremos de las subidas y bajadas de tu grupo y de los cambios del top 3.',
    'avisos.notif.accion.grupo': 'Ver mi grupo',
    'avisos.notif.accion.ranking': 'Ver ranking',
    'avisos.notif.subio': '{riotId} subió a {liga} ({lp} LP)',
    'avisos.notif.bajo': '{riotId} bajó a {liga} ({lp} LP)',
    'avisos.notif.gano': '{riotId} ganó {delta} LP ({liga} · {lp} LP)',
    'avisos.notif.perdio': '{riotId} perdió {delta} LP ({liga} · {lp} LP)',
    'avisos.notif.top3': 'Nuevo top 3 en {region} · {liga} · {cola}: {lista}',
    'avisos.notif.y': ' y ',
  },
  en: {
    'tier.CHALLENGER': 'Challenger',
    'tier.GRANDMASTER': 'Grandmaster',
    'tier.MASTER': 'Master',
    'tier.DIAMOND': 'Diamond',
    'tier.EMERALD': 'Emerald',
    'tier.PLATINUM': 'Platinum',
    'tier.GOLD': 'Gold',
    'tier.SILVER': 'Silver',
    'tier.BRONZE': 'Bronze',
    'tier.IRON': 'Iron',
    'tier.UNRANKED': 'Unranked',
    'cola.RANKED_SOLO_5x5': 'Solo / Duo',
    'cola.RANKED_FLEX_SR': 'Flex',
    'avisos.notif.grupo.titulo': 'My group · Ranking LAN',
    'avisos.notif.ranking.titulo': 'Top 3 · Ranking LAN',
    'avisos.notif.prueba.titulo': 'Test notification · Ranking LAN',
    'avisos.notif.prueba.cuerpo': 'This is how we will notify you about your group’s promotions and demotions and top 3 changes.',
    'avisos.notif.accion.grupo': 'View my group',
    'avisos.notif.accion.ranking': 'View ranking',
    'avisos.notif.subio': '{riotId} moved up to {liga} ({lp} LP)',
    'avisos.notif.bajo': '{riotId} moved down to {liga} ({lp} LP)',
    'avisos.notif.gano': '{riotId} gained {delta} LP ({liga} · {lp} LP)',
    'avisos.notif.perdio': '{riotId} lost {delta} LP ({liga} · {lp} LP)',
    'avisos.notif.top3': 'New top 3 in {region} · {liga} · {cola}: {lista}',
    'avisos.notif.y': ' and ',
  },
};

const idiomaValido = (valor) => IDIOMAS_SW.includes(valor);

/** Traduce una clave en el idioma dado interpolando {variables}, como t() en js/i18n.js. */
function tSw(idioma, clave, vars) {
  const diccionario = DICCIONARIOS_SW[idiomaValido(idioma) ? idioma : IDIOMA_POR_DEFECTO];
  let texto = diccionario[clave] ?? DICCIONARIOS_SW[IDIOMA_POR_DEFECTO][clave] ?? clave;
  if (vars) {
    for (const [nombre, valor] of Object.entries(vars)) {
      texto = texto.replaceAll(`{${nombre}}`, String(valor));
    }
  }
  return texto;
}

/* ------------------------------ serializacion ---------------------------- */

let colaAvisos = Promise.resolve();

/**
 * Ejecuta `tarea` cuando terminen las anteriores: los procesados que leen y
 * escriben CACHE_AVISOS (instantanea, pendientes, config) van de uno en uno y
 * en orden de llegada, asi dos AVISOS_DATOS casi simultaneos, un AVISOS_VISTOS
 * durante un procesado o un periodicsync a la vez que "Comprobar ahora" no
 * pierden ni duplican cambios. Un fallo no rompe la cola.
 */
function enCola(tarea) {
  const turno = colaAvisos.then(() => tarea(), () => tarea());
  colaAvisos = turno.then(() => {}, () => {});
  return turno;
}

/* ----------------------------- persistencia ------------------------------ */

/** URL sintetica bajo la que se guarda cada entrada en CACHE_AVISOS. */
const claveAvisos = (nombre) => absoluta(`./avisos/${nombre}.json`);

async function leerAvisos(nombre) {
  try {
    const guardada = await (await caches.open(CACHE_AVISOS)).match(claveAvisos(nombre));
    if (guardada) return await guardada.json();
  } catch { /* copia ilegible */ }
  return null;
}

async function guardarAvisos(nombre, datos) {
  try {
    const cache = await caches.open(CACHE_AVISOS);
    await cache.put(
      claveAvisos(nombre),
      new Response(JSON.stringify(datos), { headers: { 'Content-Type': 'application/json' } }),
    );
  } catch { /* cuota llena: el siguiente ciclo volvera a intentarlo */ }
}

function normalizarPendientes(datos) {
  const n = Number.isInteger(datos?.n) && datos.n > 0 ? datos.n : 0;
  const cambios = Array.isArray(datos?.cambios) ? datos.cambios.slice(0, MAX_CAMBIOS) : [];
  return { n, cambios };
}

/* ------------------------------ validacion ------------------------------- */

const CODIGO_VALIDO = /^[A-Za-z0-9_]{1,24}$/; // region, cola, tier, division
const codigoValido = (valor) => typeof valor === 'string' && CODIGO_VALIDO.test(valor);
const textoValido = (valor, max) => typeof valor === 'string' && valor.length > 0 && valor.length <= max;
const numeroValido = (valor) => typeof valor === 'number' && Number.isFinite(valor);

function validarMiembro(bruto) {
  if (!bruto || typeof bruto !== 'object') return null;
  const { riotId, tier, division, lp } = bruto;
  if (!textoValido(riotId, MAX_RIOT_ID) || !codigoValido(tier) || !codigoValido(division) || !numeroValido(lp)) return null;
  return { riotId, tier, division, lp };
}

function validarJugadorTop(bruto) {
  if (!bruto || typeof bruto !== 'object') return null;
  const { clave, riotId, lp } = bruto;
  if (!textoValido(clave, 100) || !textoValido(riotId, MAX_RIOT_ID) || !numeroValido(lp)) return null;
  return { clave, riotId, lp };
}

/** Config vacia: lo que hay antes del primer AVISOS_DATOS. */
const CONFIG_VACIA = () => ({
  activados: false, idioma: IDIOMA_POR_DEFECTO, region: null, cola: null, tier: null, division: null,
  grupo: { miembros: [], cola: null },
});

/**
 * Valida una config parcial: solo conserva los campos presentes y correctos
 * (los ausentes o invalidos no aparecen, para que fusionarConfig() mantenga
 * el valor guardado). `grupo` solo cuenta si viene como objeto: una lista
 * vacia explicita si reemplaza a la anterior (el usuario quito a todos).
 */
function validarConfigParcial(config) {
  const parcial = {};
  if (typeof config.activados === 'boolean') parcial.activados = config.activados;
  if (idiomaValido(config.idioma)) parcial.idioma = config.idioma;
  for (const campo of ['region', 'cola', 'tier', 'division']) {
    if (codigoValido(config[campo])) parcial[campo] = config[campo];
  }
  if (config.grupo && typeof config.grupo === 'object') {
    parcial.grupo = {
      miembros: Array.isArray(config.grupo.miembros)
        ? config.grupo.miembros.filter((r) => textoValido(r, MAX_RIOT_ID)).slice(0, MAX_MIEMBROS_AVISOS)
        : [],
      cola: codigoValido(config.grupo.cola) ? config.grupo.cola : null,
    };
  }
  return parcial;
}

/** Config guardada + parcial validada = config completa (nunca pierde campos). */
function fusionarConfig(guardada, parcial) {
  const base = guardada && typeof guardada === 'object' ? guardada : {};
  const grupo = parcial.grupo ?? (base.grupo && typeof base.grupo === 'object' ? base.grupo : null);
  return {
    ...CONFIG_VACIA(),
    ...base,
    ...parcial,
    grupo: {
      miembros: Array.isArray(grupo?.miembros) ? grupo.miembros : [],
      cola: codigoValido(grupo?.cola) ? grupo.cola : null,
    },
  };
}

/**
 * Valida tipos y topes de un AVISOS_DATOS antes de usar nada. Cada parte que
 * no cumple se descarta por separado (queda null). `config` sale como parcial
 * validada (ver validarConfigParcial).
 */
function validarDatosAvisos(mensaje) {
  const salida = { config: null, ranking: null, grupo: null };
  const { config, ranking, grupo } = mensaje;

  if (config && typeof config === 'object') salida.config = validarConfigParcial(config);

  if (ranking && typeof ranking === 'object') {
    const { region, cola, tier, division } = ranking;
    const top3 = Array.isArray(ranking.top3) && ranking.top3.length >= 1 && ranking.top3.length <= 3
      ? ranking.top3.map(validarJugadorTop)
      : [null];
    if ([region, cola, tier, division].every(codigoValido) && top3.every(Boolean)) {
      salida.ranking = { clave: `${region}|${cola}|${tier}|${division}`, region, cola, tier, division, top3 };
    }
  }

  if (grupo && typeof grupo === 'object') {
    const miembros = Array.isArray(grupo.miembros) && grupo.miembros.length <= MAX_MIEMBROS_AVISOS
      ? grupo.miembros.map(validarMiembro)
      : [null];
    if (codigoValido(grupo.region) && codigoValido(grupo.cola) && miembros.every(Boolean)) {
      salida.grupo = { region: grupo.region, cola: grupo.cola, miembros };
    }
  }

  return salida;
}

/* -------------------------------- textos --------------------------------- */

const puntuacion = ({ tier, division, lp }) => {
  const indice = ORDEN_TIERS.indexOf(tier);
  return indice < 0 ? -1 : indice * 1_000_000 + (VALOR_DIVISION[division] ?? 0) * 10_000 + lp;
};

/** Traduce un codigo (tier o cola) o lo devuelve tal cual si no esta en el diccionario. */
function nombreCodigo(prefijo, codigo, idioma) {
  const nombre = tSw(idioma, `${prefijo}.${codigo}`);
  return nombre === `${prefijo}.${codigo}` ? codigo : nombre;
}

/** "Oro II" o "Retador" (la elite no muestra division), como nombreRango() en js/ui.js. */
const nombreLiga = ({ tier, division }, idioma) =>
  TIERS_APEX.has(tier) ? nombreCodigo('tier', tier, idioma) : `${nombreCodigo('tier', tier, idioma)} ${division}`;

function textoCambioGrupo(riotId, previo, actual, idioma) {
  const liga = nombreLiga(actual, idioma);
  if (previo.tier !== actual.tier || previo.division !== actual.division) {
    const sube = puntuacion(actual) >= puntuacion(previo);
    return tSw(idioma, sube ? 'avisos.notif.subio' : 'avisos.notif.bajo', { riotId, liga, lp: actual.lp });
  }
  const delta = actual.lp - previo.lp;
  if (Math.abs(delta) < UMBRAL_LP) return null;
  return tSw(idioma, delta > 0 ? 'avisos.notif.gano' : 'avisos.notif.perdio', { riotId, liga, lp: actual.lp, delta: Math.abs(delta) });
}

function textoCambioRanking({ region, cola, tier, division, top3 }, idioma) {
  const nombres = top3.map((j) => j.riotId);
  const lista = nombres.length > 1
    ? `${nombres.slice(0, -1).join(', ')}${tSw(idioma, 'avisos.notif.y')}${nombres.at(-1)}`
    : nombres.join('');
  return tSw(idioma, 'avisos.notif.top3', {
    region: ETIQUETA_REGION[region] ?? region.toUpperCase(),
    liga: nombreLiga({ tier, division }, idioma),
    cola: nombreCodigo('cola', cola, idioma),
    lista,
  });
}

/* ------------------------- notificaciones y badge ------------------------ */

const permisoConcedido = () => typeof self.Notification !== 'undefined' && self.Notification.permission === 'granted';

/** Las dos acciones de toda notificacion, en el idioma de la app. */
const accionesNotificacion = (tag, idioma) => {
  const grupo = { action: 'grupo', title: tSw(idioma, 'avisos.notif.accion.grupo') };
  const ranking = { action: 'ranking', title: tSw(idioma, 'avisos.notif.accion.ranking') };
  return tag === 'ranking' ? [ranking, grupo] : [grupo, ranking];
};

/** Muestra (o reemplaza, por tag) una notificacion con las dos acciones. Devuelve si se mostro. */
async function mostrarNotificacion(tag, titulo, cuerpo, vista, idioma) {
  try {
    await self.registration.showNotification(titulo, {
      body: cuerpo,
      tag,
      renotify: true,
      lang: idiomaValido(idioma) ? idioma : IDIOMA_POR_DEFECTO,
      icon: absoluta('./iconos/icono-192.png'),
      data: { vista },
      actions: accionesNotificacion(tag, idioma),
    });
    return true;
  } catch (error) {
    console.warn('[SW] showNotification', error); // permiso retirado o host sin notificaciones
    return false;
  }
}

/** Una notificacion por tipo: todos los cambios del grupo juntos y el top 3 aparte. */
async function mostrarAvisos(cambios, idioma) {
  const grupo = cambios.filter((c) => c.tipo === 'grupo').map((c) => c.texto);
  const ranking = cambios.filter((c) => c.tipo === 'ranking').map((c) => c.texto);
  const tareas = [];
  if (grupo.length > 0) {
    tareas.push(mostrarNotificacion('grupo', tSw(idioma, 'avisos.notif.grupo.titulo'), grupo.join('\n'), 'grupo', idioma));
  }
  if (ranking.length > 0) {
    tareas.push(mostrarNotificacion('ranking', tSw(idioma, 'avisos.notif.ranking.titulo'), ranking.join('\n'), 'global', idioma));
  }
  await Promise.all(tareas);
}

/** Una ventana de la app visible y con el foco: el usuario ya esta mirando. */
async function hayVentanaEnfocada() {
  try {
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    return clientes.some((c) => c.focused === true && c.visibilityState !== 'hidden');
  } catch {
    return false;
  }
}

/** Pone el distintivo en n (0 lo limpia). Devuelve 'establecido' | 'limpio' | 'no-soportado' | 'error'. */
async function actualizarDistintivo(n) {
  if (!('setAppBadge' in self.navigator)) return 'no-soportado';
  try {
    if (n > 0) await self.navigator.setAppBadge(n);
    else await self.navigator.clearAppBadge();
    return n > 0 ? 'establecido' : 'limpio';
  } catch {
    return 'error';
  }
}

async function difundirAvisos(mensaje) {
  const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const cliente of clientes) cliente.postMessage(mensaje);
}

/* ------------------------------- diferencias ----------------------------- */

/**
 * Compara ranking y grupo con la instantanea, la actualiza, y si los avisos
 * estan activados notifica, acumula pendientes y actualiza el distintivo.
 * La primera vez que se ve una clave solo se guarda. Con una ventana de la
 * app enfocada no hay notificacion ni distintivo: los cambios van solo a la
 * lista "Ultimos cambios" (ya vistos, no suman al contador) y la pagina los
 * anuncia de forma discreta.
 * Debe ejecutarse dentro de enCola() (lee y escribe CACHE_AVISOS).
 */
async function procesarAvisos({ ranking, grupo }, origen) {
  const config = fusionarConfig(await leerAvisos('config'), {});
  const idioma = config.idioma;
  const guardada = await leerAvisos('instantanea');
  const instantanea = {
    grupo: guardada?.grupo && typeof guardada.grupo === 'object' ? guardada.grupo : {},
    ranking: guardada?.ranking && typeof guardada.ranking === 'object' ? guardada.ranking : {},
  };
  const momento = new Date().toISOString();
  const cambios = [];

  if (grupo) {
    for (const miembro of grupo.miembros) {
      const clave = `${grupo.region}|${grupo.cola}|${miembro.riotId.toLowerCase()}`;
      const actual = { tier: miembro.tier, division: miembro.division, lp: miembro.lp };
      const previo = instantanea.grupo[clave];
      if (previo && typeof previo === 'object') {
        const texto = textoCambioGrupo(miembro.riotId, previo, actual, idioma);
        if (texto) cambios.push({ tipo: 'grupo', texto, momento });
      }
      instantanea.grupo[clave] = actual;
    }
  }

  if (ranking) {
    const previo = instantanea.ranking[ranking.clave];
    const secuencia = (top3) => (Array.isArray(top3) ? top3.map((j) => j?.clave).join(',') : '');
    if (previo && secuencia(previo.top3) !== secuencia(ranking.top3)) {
      cambios.push({ tipo: 'ranking', texto: textoCambioRanking(ranking, idioma), momento });
    }
    instantanea.ranking[ranking.clave] = { top3: ranking.top3 };
  }

  await guardarAvisos('instantanea', instantanea);

  const pendientes = normalizarPendientes(await leerAvisos('pendientes'));
  let badge = 'omitido';
  let silencioso = false;
  if (config.activados === true && permisoConcedido()) {
    silencioso = await hayVentanaEnfocada();
    if (cambios.length > 0) {
      if (!silencioso) {
        await mostrarAvisos(cambios, idioma);
        pendientes.n += cambios.length;
      }
      pendientes.cambios = [...cambios, ...pendientes.cambios].slice(0, MAX_CAMBIOS);
      await guardarAvisos('pendientes', pendientes);
    }
    badge = silencioso ? 'enfocado' : await actualizarDistintivo(pendientes.n);
  }

  await difundirAvisos({
    tipo: 'AVISOS_PENDIENTES',
    n: pendientes.n,
    cambios: pendientes.cambios,
    badge,
    origen,
    nuevos: cambios.length,
    silencioso,
  });
}

/**
 * AVISOS_DATOS: fusiona la config si viene y procesa ranking/grupo si vienen.
 * Debe ejecutarse dentro de enCola().
 */
async function recibirDatosAvisos(mensaje) {
  const { config, ranking, grupo } = validarDatosAvisos(mensaje);
  if (config) await guardarAvisos('config', fusionarConfig(await leerAvisos('config'), config));
  if (ranking || grupo) await procesarAvisos({ ranking, grupo }, 'datos');
}

/**
 * AVISOS_PROBAR: notificacion de ejemplo en el idioma de la app y distintivo
 * en 1 (sin tocar pendientes). Debe ejecutarse dentro de enCola().
 */
async function mostrarPrueba() {
  const { idioma } = fusionarConfig(await leerAvisos('config'), {});
  const mostrado = await mostrarNotificacion(
    'prueba',
    tSw(idioma, 'avisos.notif.prueba.titulo'),
    tSw(idioma, 'avisos.notif.prueba.cuerpo'),
    'global',
    idioma,
  );
  const pendientes = normalizarPendientes(await leerAvisos('pendientes'));
  const badge = await actualizarDistintivo(Math.max(1, pendientes.n));
  await difundirAvisos({ tipo: 'AVISOS_PROBADO', mostrado, badge });
}

/**
 * AVISOS_VISTOS: la pagina recupero el foco; pendientes a 0 y distintivo
 * limpio. Debe ejecutarse dentro de enCola().
 */
async function marcarVistos() {
  const pendientes = normalizarPendientes(await leerAvisos('pendientes'));
  if (pendientes.n !== 0) {
    pendientes.n = 0;
    await guardarAvisos('pendientes', pendientes);
  }
  const badge = await actualizarDistintivo(0);
  await difundirAvisos({ tipo: 'AVISOS_PENDIENTES', n: 0, cambios: pendientes.cambios, badge, origen: 'vistos' });
}

/* ------------------------ sincronizacion periodica ----------------------- */

/** Convierte el documento del proxy (/api/ranking) en la forma `ranking` del contrato. */
function rankingDesdeDocumento(documento, { region, cola, tier, division }) {
  const lista = Array.isArray(documento.jugadores) ? documento.jugadores : [];
  const top3 = [...lista]
    .sort((a, b) => (a.puesto ?? 0) - (b.puesto ?? 0))
    .slice(0, 3)
    .map((j) => {
      const nombre = j.nombre ?? j.gameName ?? '';
      const tag = j.tag ?? j.tagLine ?? '';
      const riotId = j.riotId || (nombre ? (tag ? `${nombre}#${tag}` : nombre) : null);
      return { clave: j.puuid ?? riotId, riotId, lp: Number(j.lp ?? j.leaguePoints ?? 0) };
    });
  // Con nombres pendientes de resolver no se compara: el top 3 cambiaria solo por eso.
  if (top3.length === 0 || top3.some((j) => j.clave == null || j.riotId == null)) return null;
  return {
    region: (documento.plataforma ?? region).toLowerCase(),
    cola: documento.cola ?? cola,
    tier: documento.tier ?? tier,
    division: documento.division ?? division,
    top3,
  };
}

/** Descarga por el SW y guarda en CACHE_DATOS bajo la MISMA URL que usa la pagina. */
async function descargarYGuardar(url) {
  const respuesta = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!respuesta.ok) throw new Error(`${new URL(url).pathname} -> ${respuesta.status}`);
  const cache = await caches.open(CACHE_DATOS);
  await cache.put(url, respuesta.clone());
  return respuesta.json();
}

/**
 * Lee la config, consulta al proxy el ranking seleccionado y a cada integrante
 * del grupo y pasa el resultado por procesarAvisos(). Fallos de red: se omite
 * esa parte con console.warn. La usan periodicsync y "Comprobar ahora". Las
 * descargas van fuera de la cola (no bloquean a la pagina); solo el procesado
 * final se serializa.
 */
async function sincronizarAvisos() {
  const config = fusionarConfig(await leerAvisos('config'), {});
  if (!config.activados) return;

  const { region, cola, tier, division } = config;
  let ranking = null;
  let grupo = null;

  if ([region, cola, tier, division].every(codigoValido)) {
    // Mismo orden de parametros que urlProxy() en js/api.js.
    const url = absoluta(`./api/ranking?${new URLSearchParams({ region, cola, tier, division })}`);
    try {
      const bruto = rankingDesdeDocumento(await descargarYGuardar(url), config);
      const { ranking: valido } = validarDatosAvisos({ ranking: bruto ?? {} });
      ranking = valido;
    } catch (error) {
      console.warn('[SW] sincronizar ranking', error.message);
    }
  }

  const miembros = Array.isArray(config.grupo?.miembros) ? config.grupo.miembros : [];
  const colaGrupo = config.grupo?.cola;
  if (miembros.length > 0 && codigoValido(colaGrupo) && codigoValido(region)) {
    const resultados = await Promise.allSettled(miembros.map(async (riotId) => {
      // Mismo orden de parametros que urlJugador() en js/api.js.
      const documento = await descargarYGuardar(absoluta(`./api/jugador?${new URLSearchParams({ riotId, region })}`));
      const entrada = documento.colas?.[colaGrupo];
      if (!entrada || !entrada.tier) return null; // sin clasificar en esta cola
      return { riotId: documento.riotId || riotId, tier: entrada.tier, division: entrada.division ?? 'I', lp: Number(entrada.lp ?? 0) };
    }));
    for (const r of resultados) {
      if (r.status === 'rejected') console.warn('[SW] sincronizar jugador', r.reason?.message);
    }
    const lista = resultados.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
    const { grupo: valido } = validarDatosAvisos({ grupo: { region, cola: colaGrupo, miembros: lista } });
    grupo = valido;
  }

  await enCola(() => procesarAvisos({ ranking, grupo }, 'sincronizacion'));
}

/* ------------------------------ navegacion ------------------------------- */

/**
 * Lleva al usuario a la vista pedida: enfoca una ventana abierta y le manda
 * AVISOS_IR; si no hay ninguna, abre la app. focus()/openWindow() solo estan
 * permitidos dentro de notificationclick; fuera (AVISOS_ABRIR) se degradan a
 * postMessage sin ruido.
 */
async function abrirDestino(vista) {
  const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clientes.length > 0) {
    const cliente = clientes.find((c) => c.focused) ?? clientes[0];
    try { await cliente.focus(); } catch { /* fuera de un clic de notificacion */ }
    cliente.postMessage({ tipo: 'AVISOS_IR', vista });
    return;
  }
  try {
    await self.clients.openWindow(absoluta(`./?vista=${vista}`));
  } catch (error) {
    console.warn('[SW] openWindow', error);
  }
}

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const vista = evento.action === 'ranking' ? 'global'
    : evento.action === 'grupo' ? 'grupo'
      : (evento.notification.data?.vista ?? 'global');
  evento.waitUntil(abrirDestino(vista));
});

// Periodic Background Sync (solo con la app instalada): js/avisos.js registra
// el tag 'avisos' con minInterval de 12 h.
self.addEventListener('periodicsync', (evento) => {
  if (evento.tag === TAG_SYNC_AVISOS) evento.waitUntil(sincronizarAvisos());
});

/**
 * Capa de datos de Ranking LAN.
 *
 * Estrategia de obtencion (network-first con doble respaldo):
 *
 *   1. GET ./api/ranking?cola=..&tier=..   -> proxy Node que guarda la RIOT_API_KEY
 *   2. Cache Storage                        -> ultima respuesta buena del proxy
 *   3. ./datos/ranking-lan.json             -> semilla de demostracion (precacheada por el SW)
 *
 * La API de Riot no admite peticiones desde el navegador (no envia cabeceras CORS
 * y la clave quedaria expuesta en el cliente), asi que el paso 1 SIEMPRE pasa por
 * un backend propio. Ver servidor/proxy.mjs y README.md.
 */

import { localeActual } from './i18n.js';

export const CACHE_DATOS = 'ranking-lan-datos-v1';
export const RUTA_PROXY = './api/ranking';
export const RUTA_DEMO = './datos/ranking-lan.json';

/** Tiempo maximo de espera al proxy antes de recurrir a la cache. */
const TIEMPO_LIMITE_MS = 9000;

export const COLAS = {
  RANKED_SOLO_5x5: 'Solo / Dúo',
  RANKED_FLEX_SR: 'Flexible',
};

/** Plataformas que acepta el proxy (las etiquetas visibles viven en i18n). */
export const REGIONES = [
  'la1', 'la2', 'na1', 'br1',
  'euw1', 'eun1', 'tr1', 'ru', 'me1',
  'kr', 'jp1', 'oc1', 'sg2', 'tw2', 'vn2',
];

/** Ligas de la elite: sin divisiones (I fija). */
export const TIERS_APEX = new Set(['CHALLENGER', 'GRANDMASTER', 'MASTER']);

/** Nombres en español de todas las ligas (la vista global solo usa la élite). */
export const TIERS = {
  CHALLENGER: 'Retador',
  GRANDMASTER: 'Gran Maestro',
  MASTER: 'Maestro',
  DIAMOND: 'Diamante',
  EMERALD: 'Esmeralda',
  PLATINUM: 'Platino',
  GOLD: 'Oro',
  SILVER: 'Plata',
  BRONZE: 'Bronce',
  IRON: 'Hierro',
  UNRANKED: 'Sin clasificar',
};

/** Origenes posibles de los datos que se muestran. */
export const FUENTE = {
  VIVO: 'vivo',
  CACHE: 'cache',
  DEMO: 'demo',
};

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */

/** fetch con tiempo limite propio (AbortController). */
async function fetchConLimite(url, ms = TIEMPO_LIMITE_MS) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(new DOMException('Tiempo agotado', 'TimeoutError')), ms);
  try {
    return await fetch(url, { signal: control.signal, headers: { Accept: 'application/json' } });
  } finally {
    clearTimeout(reloj);
  }
}

/** Cache Storage puede no existir (contexto no seguro); devolvemos null sin romper. */
async function abrirCache() {
  if (!('caches' in globalThis)) return null;
  try {
    return await caches.open(CACHE_DATOS);
  } catch {
    return null;
  }
}

/**
 * Normaliza un jugador para que la UI no dependa de la forma exacta de la
 * respuesta. Calcula partidas y winrate una sola vez.
 */
function normalizarJugador(bruto, indice) {
  const victorias = Number(bruto.victorias ?? bruto.wins ?? 0);
  const derrotas = Number(bruto.derrotas ?? bruto.losses ?? 0);
  const partidas = victorias + derrotas;
  const nombre = bruto.nombre ?? bruto.gameName ?? '';
  const tag = bruto.tag ?? bruto.tagLine ?? '';

  return {
    puesto: Number(bruto.puesto ?? indice + 1),
    // riotId/nombre null = el proxy aun no resuelve este nombre (rate limit);
    // la interfaz muestra un marcador y el dato llega en la proxima recarga.
    riotId: bruto.riotId || (nombre ? (tag ? `${nombre}#${tag}` : nombre) : null),
    nombre: nombre || (bruto.riotId ? bruto.riotId.split('#')[0] : null),
    tag,
    puuid: bruto.puuid ?? null,
    tier: bruto.tier ?? '',
    division: bruto.division ?? bruto.rank ?? 'I',
    lp: Number(bruto.lp ?? bruto.leaguePoints ?? 0),
    victorias,
    derrotas,
    partidas,
    // Winrate en porcentaje (0-100). Sin partidas no hay winrate.
    winrate: partidas > 0 ? (victorias / partidas) * 100 : null,
    racha: Boolean(bruto.racha ?? bruto.hotStreak),
    veterano: Boolean(bruto.veterano ?? bruto.veteran),
    nuevo: Boolean(bruto.nuevo ?? bruto.freshBlood),
    inactivo: Boolean(bruto.inactivo ?? bruto.inactive),
  };
}

/** Normaliza el documento completo devuelto por el proxy. */
function normalizarListado(documento, { region, cola, tier, division, fuente }) {
  const jugadores = (documento.jugadores ?? []).map(normalizarJugador);
  return {
    fuente: fuente ?? documento.fuente ?? FUENTE.VIVO,
    aviso: documento.aviso ?? null,
    region: (documento.plataforma ?? region ?? 'la1').toLowerCase(),
    cola: documento.cola ?? cola,
    tier: documento.tier ?? tier,
    division: documento.division ?? division ?? 'I',
    actualizado: documento.actualizado ?? null,
    nombresPendientes: Number(documento.nombresPendientes ?? 0),
    jugadores,
    total: jugadores.length,
  };
}

/* ------------------------------------------------------------------ *
 * Pasos de la estrategia
 * ------------------------------------------------------------------ */

function urlProxy({ region, cola, tier, division }) {
  const parametros = new URLSearchParams({ region, cola, tier, division });
  return `${RUTA_PROXY}?${parametros}`;
}

/** Paso 1: el proxy. Lanza excepcion si no responde o responde mal. */
async function desdeProxy({ region, cola, tier, division }) {
  const url = urlProxy({ region, cola, tier, division });
  const respuesta = await fetchConLimite(url);

  if (!respuesta.ok) {
    throw new Error(`El proxy respondió ${respuesta.status}`);
  }

  // El service worker marca con esta cabecera las respuestas que sirvio desde
  // su propia cache al no haber red, para no anunciarlas como datos en vivo.
  const servidaDeCache = respuesta.headers.get('X-Ranking-Origen') === 'cache';

  // Guardamos una copia antes de consumir el cuerpo (solo si es fresca).
  if (!servidaDeCache) {
    const cache = await abrirCache();
    if (cache) {
      try {
        await cache.put(url, respuesta.clone());
      } catch { /* cuota llena o respuesta no cacheable: no es critico */ }
    }
  }

  const documento = await respuesta.json();

  // El proxy indica en el propio cuerpo si sirvio datos reales o la semilla demo
  // (cuando no hay RIOT_API_KEY configurada). La demo sigue siendo demo aunque
  // venga de la cache.
  let fuente = documento.fuente === FUENTE.DEMO ? FUENTE.DEMO : FUENTE.VIVO;
  if (servidaDeCache && fuente !== FUENTE.DEMO) fuente = FUENTE.CACHE;

  return normalizarListado(documento, { region, cola, tier, division, fuente });
}

/** Paso 2: la ultima respuesta buena guardada en Cache Storage. */
async function desdeCache({ region, cola, tier, division }) {
  const cache = await abrirCache();
  if (!cache) return null;

  const respuesta = await cache.match(urlProxy({ region, cola, tier, division }));
  if (!respuesta) return null;

  const documento = await respuesta.json();
  // Si lo guardado era la semilla demo, sigue siendo demo.
  const fuente = documento.fuente === FUENTE.DEMO ? FUENTE.DEMO : FUENTE.CACHE;
  return normalizarListado(documento, { region, cola, tier, division, fuente });
}

/**
 * Paso 3: la semilla de demostracion incluida en el paquete. Solo cubre la
 * elite (Retador/GM/Maestro); para ligas menores sin red ni cache devuelve
 * un listado vacio y la interfaz lo explica.
 */
async function desdeDemo({ region, cola, tier, division }) {
  const respuesta = await fetch(RUTA_DEMO, { headers: { Accept: 'application/json' } });
  if (!respuesta.ok) throw new Error('No se pudo leer los datos de demostración');

  const documento = await respuesta.json();
  const jugadores = documento.listados?.[`${cola}|${tier}`] ?? [];

  return normalizarListado(
    { ...documento, plataforma: region, cola, tier, division, jugadores },
    { region, cola, tier, division, fuente: FUENTE.DEMO },
  );
}

/* ------------------------------------------------------------------ *
 * API publica
 * ------------------------------------------------------------------ */

/**
 * Devuelve un listado del ladder.
 *
 * @param {object} opciones
 * @param {string} opciones.region   la1 | la2 | na1 | ... (ver REGIONES)
 * @param {string} opciones.cola     RANKED_SOLO_5x5 | RANKED_FLEX_SR
 * @param {string} opciones.tier     CHALLENGER ... IRON
 * @param {string} [opciones.division] I-IV (solo ligas bajo Maestro)
 * @param {boolean} [opciones.omitirRed] true = directo a cache/demo (sin red).
 * @returns {Promise<object>} listado normalizado, siempre con `fuente` y `jugadores`
 */
export async function obtenerRanking({ region = 'la1', cola, tier, division = 'I', omitirRed = false }) {
  const consulta = { region, cola, tier, division };
  const problemas = [];

  if (!omitirRed) {
    try {
      return await desdeProxy(consulta);
    } catch (error) {
      problemas.push(error.message);
    }
  }

  try {
    const enCache = await desdeCache(consulta);
    if (enCache && enCache.jugadores.length > 0) {
      return { ...enCache, problemas };
    }
  } catch (error) {
    problemas.push(error.message);
  }

  const demo = await desdeDemo(consulta);
  return { ...demo, problemas };
}

/* ------------------------------------------------------------------ *
 * Un jugador concreto (seccion "Mi grupo")
 * ------------------------------------------------------------------ */

export class ErrorDatos extends Error {
  constructor(mensaje, estado = 0) {
    super(mensaje);
    this.estado = estado;
  }
}

/** Normaliza la entrada de una cola (o null si esta sin clasificar). */
function normalizarEntrada(bruto) {
  if (!bruto) return null;
  const victorias = Number(bruto.victorias ?? 0);
  const derrotas = Number(bruto.derrotas ?? 0);
  const partidas = victorias + derrotas;
  return {
    tier: bruto.tier ?? 'UNRANKED',
    division: bruto.division ?? 'I',
    lp: Number(bruto.lp ?? 0),
    victorias,
    derrotas,
    partidas,
    winrate: partidas > 0 ? (victorias / partidas) * 100 : null,
    racha: Boolean(bruto.racha),
    veterano: Boolean(bruto.veterano),
    nuevo: Boolean(bruto.nuevo),
    inactivo: Boolean(bruto.inactivo),
  };
}

function normalizarPerfil(documento, fuente) {
  const riotId = documento.riotId ?? 'Desconocido';
  const pos = riotId.lastIndexOf('#');
  return {
    fuente,
    aviso: documento.aviso ?? null,
    riotId,
    nombre: pos > 0 ? riotId.slice(0, pos) : riotId,
    tag: pos > 0 ? riotId.slice(pos + 1) : '',
    puuid: documento.puuid ?? null,
    actualizado: documento.actualizado ?? null,
    colas: {
      RANKED_SOLO_5x5: normalizarEntrada(documento.colas?.RANKED_SOLO_5x5),
      RANKED_FLEX_SR: normalizarEntrada(documento.colas?.RANKED_FLEX_SR),
    },
  };
}

const urlJugador = (riotId, region) =>
  `./api/jugador?${new URLSearchParams({ riotId, region })}`;

/**
 * Rango de un jugador por su Riot ID (Nombre#TAG) en una region, con la misma
 * estrategia proxy -> cache que obtenerRanking. Un 404 (la cuenta no existe)
 * o un 400 (formato invalido) se relanzan SIEMPRE como ErrorDatos: son
 * informacion real que no debe taparse con la cache.
 */
export async function obtenerJugador({ riotId, region = 'la1', omitirRed = false }) {
  const url = urlJugador(riotId, region);
  const problemas = [];

  if (!omitirRed) {
    try {
      const respuesta = await fetchConLimite(url);

      if (respuesta.status === 404 || respuesta.status === 400) {
        const cuerpo = await respuesta.json().catch(() => ({}));
        throw new ErrorDatos(cuerpo.error ?? `El proxy respondió ${respuesta.status}`, respuesta.status);
      }
      if (!respuesta.ok) throw new ErrorDatos(`El proxy respondió ${respuesta.status}`, respuesta.status);

      const servidaDeCache = respuesta.headers.get('X-Ranking-Origen') === 'cache';
      if (!servidaDeCache) {
        const cache = await abrirCache();
        if (cache) {
          try { await cache.put(url, respuesta.clone()); } catch { /* cuota llena: no es critico */ }
        }
      }

      const documento = await respuesta.json();
      let fuente = documento.fuente === FUENTE.DEMO ? FUENTE.DEMO : FUENTE.VIVO;
      if (servidaDeCache && fuente !== FUENTE.DEMO) fuente = FUENTE.CACHE;
      return normalizarPerfil(documento, fuente);
    } catch (error) {
      if (error instanceof ErrorDatos && (error.estado === 404 || error.estado === 400)) throw error;
      problemas.push(error.message);
    }
  }

  const cache = await abrirCache();
  const guardada = cache && (await cache.match(url));
  if (guardada) {
    const documento = await guardada.json();
    const fuente = documento.fuente === FUENTE.DEMO ? FUENTE.DEMO : FUENTE.CACHE;
    return normalizarPerfil(documento, fuente);
  }

  throw new ErrorDatos(problemas[0] ?? 'Sin conexión y sin datos guardados de este jugador');
}

/* ------------------------------------------------------------------ *
 * Historial de partidas (seccion "Mi grupo")
 * ------------------------------------------------------------------ */

/**
 * Ultimas partidas clasificatorias de un jugador (match-v5 via el proxy).
 * En demo el proxy genera un historial ficticio estable; se usa riotId como
 * semilla cuando no hay puuid. Misma estrategia red -> cache.
 */
export async function obtenerHistorial({ puuid, riotId, region = 'la1', omitirRed = false }) {
  const parametros = new URLSearchParams({ region });
  if (puuid) parametros.set('puuid', puuid);
  else if (riotId) parametros.set('riotId', riotId);
  const url = `./api/historial?${parametros}`;

  const problemas = [];

  if (!omitirRed) {
    try {
      const respuesta = await fetchConLimite(url);
      if (!respuesta.ok) throw new ErrorDatos(`El proxy respondió ${respuesta.status}`, respuesta.status);

      const servidaDeCache = respuesta.headers.get('X-Ranking-Origen') === 'cache';
      if (!servidaDeCache) {
        const cache = await abrirCache();
        if (cache) {
          try { await cache.put(url, respuesta.clone()); } catch { /* sin espacio */ }
        }
      }

      const documento = await respuesta.json();
      let fuente = documento.fuente === FUENTE.DEMO ? FUENTE.DEMO : FUENTE.VIVO;
      if (servidaDeCache && fuente !== FUENTE.DEMO) fuente = FUENTE.CACHE;
      return { fuente, partidas: documento.partidas ?? [] };
    } catch (error) {
      problemas.push(error.message);
    }
  }

  const cache = await abrirCache();
  const guardada = cache && (await cache.match(url));
  if (guardada) {
    const documento = await guardada.json();
    const fuente = documento.fuente === FUENTE.DEMO ? FUENTE.DEMO : FUENTE.CACHE;
    return { fuente, partidas: documento.partidas ?? [] };
  }

  throw new ErrorDatos(problemas[0] ?? 'Sin conexión y sin historial guardado');
}

/* ------------------------------------------------------------------ *
 * Orden de rangos
 * ------------------------------------------------------------------ */

/** De peor a mejor liga, como en el juego. */
export const ORDEN_TIERS = [
  'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM',
  'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER',
];

const VALOR_DIVISION = { I: 3, II: 2, III: 1, IV: 0 };

/**
 * Puntuacion comparable entre ligas: liga > division > LP.
 * Sin clasificar (null) puntua -1 para quedar al final.
 */
export function puntuacionRango(entrada) {
  if (!entrada) return -1;
  const tier = ORDEN_TIERS.indexOf(entrada.tier);
  if (tier < 0) return -1;
  return tier * 1_000_000 + (VALOR_DIVISION[entrada.division] ?? 0) * 10_000 + entrada.lp;
}

/* ------------------------------------------------------------------ *
 * Formateo (es-MX, con degradacion si Intl no trae los datos)
 * ------------------------------------------------------------------ */

// Los formateadores siguen al idioma activo; se crean una vez por locale.
const cacheFormatos = new Map();

function formatos() {
  const locale = localeActual();
  let f = cacheFormatos.get(locale);
  if (!f) {
    f = {
      numero: new Intl.NumberFormat(locale),
      relativo: new Intl.RelativeTimeFormat(locale.split('-')[0], { numeric: 'auto' }),
    };
    cacheFormatos.set(locale, f);
  }
  return f;
}

export const numero = (n) => formatos().numero.format(n ?? 0);

const UNIDADES = [
  ['year', 31536000],
  ['month', 2592000],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** "hace 5 minutos" / "5 minutes ago" a partir de una fecha ISO. */
export function tiempoRelativo(iso) {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';

  const segundos = Math.round((fecha.getTime() - Date.now()) / 1000);
  const ajustados = Math.abs(segundos) < 45 ? (segundos < 0 ? -30 : 30) : segundos;

  for (const [unidad, factor] of UNIDADES) {
    if (Math.abs(ajustados) >= factor) {
      return formatos().relativo.format(Math.round(ajustados / factor), unidad);
    }
  }
  return '';
}

/** Fecha y hora completas, para el atributo title. */
export function fechaCompleta(iso) {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleString(localeActual(), { dateStyle: 'medium', timeStyle: 'short' });
}

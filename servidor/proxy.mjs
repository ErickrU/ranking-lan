/**
 * Ranking LAN · servidor de desarrollo + proxy de la API de Riot
 * ---------------------------------------------------------------
 * Cero dependencias: solo modulos nativos de Node.
 *
 * Hace dos cosas:
 *
 *   1. Sirve los archivos estaticos de la PWA (necesario: un service worker
 *      exige http://localhost o https, no funciona con file://).
 *
 *   2. Expone GET /api/ranking?cola=..&tier=..&top=..
 *      La API de Riot no envia cabeceras CORS y la clave no puede viajar al
 *      navegador, asi que este proceso es quien habla con Riot y guarda la
 *      RIOT_API_KEY del lado del servidor.
 *
 * Sin RIOT_API_KEY el endpoint responde con la semilla de datos/ranking-lan.json
 * marcada como "fuente": "demo", de modo que la PWA sigue siendo usable.
 *
 * Uso:
 *   node servidor/proxy.mjs
 *   RIOT_API_KEY=RGAPI-xxxx node servidor/proxy.mjs --puerto 8080 --top 30
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ==========================================================================
   Configuracion
   ========================================================================== */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

// Carga .env si existe (Node >= 20.12). No es obligatorio.
try {
  process.loadEnvFile(join(RAIZ, '.env'));
} catch { /* no hay .env: se usan las variables del entorno */ }

/** Lee un flag de la linea de comandos: --puerto 8080 */
function flag(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const CONFIG = {
  puerto: Number(flag('puerto') ?? process.env.PUERTO ?? process.env.PORT ?? 8080),
  clave: process.env.RIOT_API_KEY?.trim() || null,

  /** Plataforma de LAN (Latinoamerica Norte). LAS seria la2. */
  plataforma: process.env.PLATAFORMA?.trim() || 'la1',
  /** Ruteo regional para account-v1: LAN pertenece a americas. */
  region: 'americas',

  /**
   * Cuantos jugadores resolver con nombre. Cada uno cuesta una llamada extra a
   * account-v1, y una clave de desarrollo permite 100 peticiones cada 2 minutos.
   */
  top: Math.min(Number(flag('top') ?? process.env.TOP_JUGADORES ?? 25), 200),

  /** Vida de la cache en memoria. El ladder no cambia cada segundo. */
  ttlMs: Number(process.env.TTL_SEGUNDOS ?? 600) * 1000,
};

const COLAS_VALIDAS = new Set(['RANKED_SOLO_5x5', 'RANKED_FLEX_SR']);

/** Ligas de la elite: un solo listado por cola, sin divisiones. */
const TIERS_VALIDOS = {
  CHALLENGER: 'challengerleagues',
  GRANDMASTER: 'grandmasterleagues',
  MASTER: 'masterleagues',
};

/** Ligas con divisiones I-IV: se consultan con league-v4 entries. */
const TIERS_MENORES = new Set(['DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON']);
const DIVISIONES = new Set(['I', 'II', 'III', 'IV']);

/** Tope de filas por listado: Maestro en KR trae miles y la respuesta pesaria MB. */
const MAX_LISTADO = 500;

/**
 * Plataformas soportadas y su ruteo regional:
 *  - cuenta: account-v1 (americas | europe | asia)
 *  - partidas: match-v5 (americas | europe | asia | sea)
 */
const REGIONES = {
  la1: { cuenta: 'americas', partidas: 'americas' },
  la2: { cuenta: 'americas', partidas: 'americas' },
  na1: { cuenta: 'americas', partidas: 'americas' },
  br1: { cuenta: 'americas', partidas: 'americas' },
  euw1: { cuenta: 'europe', partidas: 'europe' },
  eun1: { cuenta: 'europe', partidas: 'europe' },
  tr1: { cuenta: 'europe', partidas: 'europe' },
  ru: { cuenta: 'europe', partidas: 'europe' },
  me1: { cuenta: 'europe', partidas: 'europe' },
  kr: { cuenta: 'asia', partidas: 'asia' },
  jp1: { cuenta: 'asia', partidas: 'asia' },
  oc1: { cuenta: 'asia', partidas: 'sea' },
  sg2: { cuenta: 'asia', partidas: 'sea' },
  tw2: { cuenta: 'asia', partidas: 'sea' },
  vn2: { cuenta: 'asia', partidas: 'sea' },
};

/** Lee y valida ?region=; sin parametro usa la plataforma por defecto. */
function regionDe(url) {
  const region = (url.searchParams.get('region') ?? CONFIG.plataforma).toLowerCase();
  return region in REGIONES ? region : null;
}

/* ==========================================================================
   Cache en memoria
   ========================================================================== */

/** Listados completos: clave `${cola}|${tier}|${top}`. */
const cacheListados = new Map();
/** puuid -> { gameName, tagLine }. Los Riot ID cambian muy poco. */
const cacheNombres = new Map();
const TTL_NOMBRES_MS = 24 * 60 * 60 * 1000;

/** Momento hasta el que Riot nos pidio esperar tras un 429. */
let esperarHasta = 0;

/* ==========================================================================
   Cliente de la API de Riot
   ========================================================================== */

class ErrorRiot extends Error {
  constructor(mensaje, estado, reintentarEn) {
    super(mensaje);
    this.estado = estado;
    this.reintentarEn = reintentarEn;
  }
}

/* --------------------------------------------------------------------------
 * Presupuesto de peticiones (rate limit de la clave: 20/1 s y 100/2 min).
 *
 * En lugar de ritmos fijos conservadores, se contabiliza cada peticion en sus
 * dos ventanas y se gasta TODO el presupuesto disponible. La cola de nombres
 * en segundo plano pide turno con una RESERVA: nunca consume los ultimos
 * huecos de la ventana de 2 minutos, que quedan para el trafico interactivo
 * (listados, jugadores del grupo, historiales).
 * -------------------------------------------------------------------------- */
const LIMITE_SEGUNDO = 20;
const LIMITE_VENTANA = 100;      // por 120 s
const RESERVA_INTERACTIVA = 22;  // huecos de la ventana reservados a usuarios

/** Marcas de tiempo (ms) de las peticiones enviadas, en orden cronologico. */
const marcasPeticiones = [];

function usoActual() {
  const ahora = Date.now();
  while (marcasPeticiones.length && ahora - marcasPeticiones[0] >= 120_000) {
    marcasPeticiones.shift();
  }
  let segundo = 0;
  for (let i = marcasPeticiones.length - 1; i >= 0 && ahora - marcasPeticiones[i] < 1000; i--) {
    segundo++;
  }
  return { segundo, ventana: marcasPeticiones.length };
}

/**
 * Bloquea hasta que haya un hueco en ambas ventanas (y registra la peticion).
 * reserva > 0 = trafico de fondo: espera lo que haga falta, incluso castigos
 * largos de Riot. reserva = 0 = trafico interactivo: si el castigo o la
 * ventana no dan para responder pronto, falla rapido para que el cliente
 * caiga a su cache en lugar de colgar la peticion HTTP.
 */
async function esperarTurno(reserva = 0) {
  for (;;) {
    const castigoMs = esperarHasta - Date.now();
    if (castigoMs > 0) {
      if (reserva === 0 && castigoMs > 2500) {
        throw new ErrorRiot(
          `Límite de peticiones activo, reintenta en ${Math.ceil(castigoMs / 1000)} s`,
          429,
          Math.ceil(castigoMs / 1000),
        );
      }
      await new Promise((r) => setTimeout(r, Math.min(castigoMs + 150, 5000)));
      continue;
    }

    const { segundo, ventana } = usoActual();
    // Margen de 2 por las peticiones en vuelo que Riot ya cuenta y nosotros no.
    if (segundo <= LIMITE_SEGUNDO - 2 && ventana <= LIMITE_VENTANA - 2 - reserva) {
      marcasPeticiones.push(Date.now());
      return;
    }
    if (reserva === 0 && ventana > LIMITE_VENTANA - 4) {
      throw new ErrorRiot('Presupuesto de peticiones agotado, reintenta en un momento', 429, 20);
    }
    await new Promise((r) => setTimeout(r, segundo > LIMITE_SEGUNDO - 4 ? 150 : 1200));
  }
}

/**
 * Riot devuelve el uso real en X-App-Rate-Limit-Count ("3:1,45:120"). Tras un
 * reinicio de la tarea el contador local parte de cero: esta sincronizacion
 * adopta el conteo del servidor cuando es mayor, para no reventar la ventana.
 */
function sincronizarConCabeceras(respuesta) {
  const conteo = respuesta.headers.get('X-App-Rate-Limit-Count');
  if (!conteo) return;
  for (const par of conteo.split(',')) {
    const [usadas, ventanaSeg] = par.split(':').map(Number);
    if (ventanaSeg !== 120 || !Number.isFinite(usadas)) continue;
    const { ventana } = usoActual();
    if (usadas > ventana) {
      const marca = Date.now() - 5000; // dentro de la ventana, fuera del ultimo segundo
      for (let i = ventana; i < usadas; i++) marcasPeticiones.push(marca);
      marcasPeticiones.sort((a, b) => a - b);
    }
  }
}

async function pedirARiot(url, opciones = {}) {
  const { reintento = true, reserva = 0 } = opciones;

  await esperarTurno(reserva);

  const respuesta = await fetch(url, {
    headers: { 'X-Riot-Token': CONFIG.clave, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  sincronizarConCabeceras(respuesta);

  if (respuesta.status === 429) {
    const espera = Number(respuesta.headers.get('Retry-After') ?? 10);
    esperarHasta = Date.now() + espera * 1000;
    // Un 429 con Retry-After corto es el limite POR SEGUNDO: se reintenta una
    // vez en silencio en lugar de degradar la respuesta a demo.
    if (reintento && espera <= 2) {
      await new Promise((r) => setTimeout(r, espera * 1000 + 250));
      return pedirARiot(url, { reintento: false, reserva });
    }
    throw new ErrorRiot(`Riot devolvió 429 (rate limit). Espera ${espera} s.`, 429, espera);
  }

  if (respuesta.status === 401 || respuesta.status === 403) {
    throw new ErrorRiot(
      'Riot rechazó la clave (401/403). Las claves de desarrollo caducan cada 24 h: ' +
      'genera una nueva en https://developer.riotgames.com/',
      respuesta.status,
    );
  }

  if (!respuesta.ok) {
    throw new ErrorRiot(`Riot devolvió ${respuesta.status}`, respuesta.status);
  }

  return respuesta.json();
}

/** Ejecuta tareas con un limite de concurrencia. El ritmo real lo marca
    esperarTurno(): aqui solo se limita cuantas van en vuelo a la vez. */
async function enLotes(elementos, tamanoLote, tarea) {
  const salida = [];
  for (let i = 0; i < elementos.length; i += tamanoLote) {
    const lote = elementos.slice(i, i + tamanoLote);
    salida.push(...(await Promise.all(lote.map(tarea))));
  }
  return salida;
}

/** puuid -> Riot ID (gameName#tagLine) usando account-v1 en el ruteo indicado. */
async function resolverRiotId(puuid, ruteoCuenta, opciones = {}) {
  const guardado = cacheNombres.get(puuid);
  if (guardado && Date.now() - guardado.momento < TTL_NOMBRES_MS) return guardado.valor;

  try {
    const cuenta = await pedirARiot(
      `https://${ruteoCuenta}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`,
      opciones,
    );
    const valor = { nombre: cuenta.gameName ?? '', tag: cuenta.tagLine ?? '' };
    cacheNombres.set(puuid, { valor, momento: Date.now() });
    return valor;
  } catch (error) {
    // Un nombre que no se resuelve no debe tumbar todo el listado.
    if (error.estado === 429) throw error;
    return null;
  }
}

/** Nombre ya resuelto y vigente en cache, o null (sin llamar a Riot). */
function nombreEnCache(puuid) {
  const guardado = cacheNombres.get(puuid);
  return guardado && Date.now() - guardado.momento < TTL_NOMBRES_MS ? guardado.valor : null;
}

/* ------------------------------------------------------------------ *
 * Resolucion de nombres en SEGUNDO PLANO.
 *
 * Mostrar el listado completo (hasta 500 filas) es una sola llamada a
 * league-v4, pero cada Riot ID cuesta una llamada a account-v1 y una clave
 * de desarrollo solo permite 100 peticiones cada 2 minutos. Estrategia:
 * los primeros CONFIG.top nombres se resuelven en el momento; el resto se
 * encola aqui y se resuelve despacio (lotes de 5 cada 7 s ~ 85/2 min),
 * llenando la cache para las siguientes peticiones.
 * ------------------------------------------------------------------ */
const colaNombres = [];
const enColaNombres = new Set();
let resolviendoNombres = false;

function encolarNombres(entradas, ruteoCuenta) {
  for (const entrada of entradas) {
    const puuid = entrada.puuid;
    if (!puuid || enColaNombres.has(puuid) || nombreEnCache(puuid)) continue;
    if (colaNombres.length >= 2000) break; // no crecer sin limite
    colaNombres.push({ puuid, ruteoCuenta });
    enColaNombres.add(puuid);
  }
  procesarColaNombres();
}

async function procesarColaNombres() {
  if (resolviendoNombres || !CONFIG.clave) return;
  resolviendoNombres = true;
  try {
    // 4 trabajadores en paralelo. El ritmo real lo marca esperarTurno() con
    // RESERVA_INTERACTIVA: la cola consume todo el presupuesto LIBRE de la
    // ventana de 2 minutos y se frena sola cuando hay trafico de usuarios.
    const trabajador = async () => {
      while (colaNombres.length > 0) {
        const { puuid, ruteoCuenta } = colaNombres.shift();
        try {
          await resolverRiotId(puuid, ruteoCuenta, { reserva: RESERVA_INTERACTIVA });
        } catch { /* la cola nunca muere por un nombre */ }
        finally { enColaNombres.delete(puuid); }
      }
    };
    await Promise.all(Array.from({ length: 4 }, trabajador));
  } finally {
    resolviendoNombres = false;
  }
}

/**
 * Descarga un listado real del ladder y lo normaliza a la forma que espera
 * la PWA. Para la elite (Retador/GM/Maestro) usa las ligas completas; para
 * Diamante e inferiores usa league-v4 entries con division (pagina 1).
 *
 * Devuelve TODAS las filas (hasta MAX_LISTADO). Los nombres de los primeros
 * CONFIG.top se resuelven aqui; el resto sale de cache o se encola para el
 * resolvedor en segundo plano y llega como riotId=null mientras tanto.
 */
async function obtenerListadoReal(region, cola, tier, division, nombresSincronos = CONFIG.top) {
  const ruteo = REGIONES[region];
  let entradas;
  let nombreLiga = null;

  if (tier in TIERS_VALIDOS) {
    const liga = await pedirARiot(
      `https://${region}.api.riotgames.com/lol/league/v4/${TIERS_VALIDOS[tier]}/by-queue/${cola}`,
    );
    entradas = liga.entries ?? [];
    nombreLiga = liga.name ?? null;
  } else {
    entradas = await pedirARiot(
      `https://${region}.api.riotgames.com/lol/league/v4/entries/${cola}/${tier}/${division}?page=1`,
    );
  }

  entradas = [...entradas]
    .sort((a, b) => (b.leaguePoints ?? 0) - (a.leaguePoints ?? 0))
    .slice(0, MAX_LISTADO);

  // summonerName quedo obsoleto en noviembre de 2023: el nombre visible se
  // resuelve con account-v1 a partir del puuid, solo para la cabeza del listado.
  // Un 429 al resolver UN nombre no debe tumbar el listado completo: ese
  // nombre queda pendiente (placeholder) y lo recoge la cola en segundo plano.
  const cabeza = entradas.slice(0, nombresSincronos);
  const nombresCabeza = await enLotes(cabeza, 10, (entrada) =>
    entrada.puuid
      ? resolverRiotId(entrada.puuid, ruteo.cuenta).catch(() => null)
      : Promise.resolve(null),
  );
  // Se encola TODO: los ya resueltos se descartan solos (estan en cache) y
  // los de la cabeza que fallaron por rate limit reciben otra oportunidad.
  encolarNombres(entradas, ruteo.cuenta);

  let pendientes = 0;
  const jugadores = entradas.map((entrada, i) => {
    const identidad = i < cabeza.length ? nombresCabeza[i] : nombreEnCache(entrada.puuid);
    const nombre = identidad?.nombre || '';
    const tag = identidad?.tag || '';
    if (!nombre) pendientes++;

    return {
      puesto: i + 1,
      riotId: nombre ? (tag ? `${nombre}#${tag}` : nombre) : null,
      nombre: nombre || null,
      tag,
      puuid: entrada.puuid ?? null,
      tier: entrada.tier ?? tier,
      division: entrada.rank ?? division,
      lp: entrada.leaguePoints ?? 0,
      victorias: entrada.wins ?? 0,
      derrotas: entrada.losses ?? 0,
      racha: Boolean(entrada.hotStreak),
      veterano: Boolean(entrada.veteran),
      nuevo: Boolean(entrada.freshBlood),
      inactivo: Boolean(entrada.inactive),
      cola,
    };
  });

  return {
    esquema: 1,
    fuente: 'vivo',
    region: region.toUpperCase(),
    plataforma: region,
    cola,
    tier,
    division: tier in TIERS_VALIDOS ? 'I' : division,
    liga: nombreLiga,
    actualizado: new Date().toISOString(),
    total: jugadores.length,
    nombresPendientes: pendientes,
    jugadores,
  };
}

/**
 * Rellena en un listado cacheado los nombres que la cola de fondo ya resolvio
 * y re-encola los que sigan pendientes (por si la cola se vacio o reinicio).
 */
function hidratarListado(listado, region) {
  if (!listado.nombresPendientes) return listado;

  let pendientes = 0;
  const sinNombre = [];
  const jugadores = listado.jugadores.map((jugador) => {
    if (jugador.riotId || !jugador.puuid) {
      if (!jugador.riotId) pendientes++;
      return jugador;
    }
    const identidad = nombreEnCache(jugador.puuid);
    if (!identidad?.nombre) {
      pendientes++;
      sinNombre.push(jugador);
      return jugador;
    }
    return {
      ...jugador,
      riotId: identidad.tag ? `${identidad.nombre}#${identidad.tag}` : identidad.nombre,
      nombre: identidad.nombre,
      tag: identidad.tag,
    };
  });

  if (sinNombre.length > 0) encolarNombres(sinNombre, REGIONES[region].cuenta);
  const hidratado = { ...listado, jugadores, nombresPendientes: pendientes };
  // El propio objeto cacheado se actualiza: la proxima peticion parte de aqui.
  cacheListados.get(`${region}|${listado.cola}|${listado.tier}|${listado.division}`) &&
    (cacheListados.get(`${region}|${listado.cola}|${listado.tier}|${listado.division}`).valor = hidratado);
  return hidratado;
}

/* ==========================================================================
   Semilla de demostracion
   ========================================================================== */

let demoEnMemoria = null;

/** Mini generador de nombres para los listados demo de ligas menores. */
const PREFIJOS_DEMO = ['Sombra', 'Jaguar', 'Condor', 'Volcan', 'Trueno', 'Colibri', 'Puma', 'Halcon', 'Marea', 'Bruma', 'Nopal', 'Coyote'];
const SUFIJOS_DEMO = ['Veloz', 'Eterno', 'Astral', 'Dorado', 'Feroz', 'Sereno', 'Bravo', 'Fugaz', 'Glacial', 'Radiante'];

/**
 * Listado demo determinista para Diamante e inferiores (la semilla estatica
 * solo trae la elite). Mismo region+cola+tier+division => mismos jugadores.
 */
function listadoDemoMenor(region, cola, tier, division) {
  const al = crearAleatorio(hashCadena(`${region}|${cola}|${tier}|${division}`));
  const cantidad = 60 + Math.floor(al() * 40);
  const vistos = new Set();
  const jugadores = [];

  for (let i = 0; i < cantidad; i++) {
    let nombre;
    do {
      nombre = `${PREFIJOS_DEMO[Math.floor(al() * PREFIJOS_DEMO.length)]}${SUFIJOS_DEMO[Math.floor(al() * SUFIJOS_DEMO.length)]}${Math.floor(al() * 99)}`;
    } while (vistos.has(nombre));
    vistos.add(nombre);

    const partidas = 30 + Math.floor(al() * 300);
    const victorias = Math.round(partidas * (0.42 + al() * 0.18));
    jugadores.push({
      puesto: i + 1,
      riotId: `${nombre}#${region.toUpperCase()}`,
      nombre,
      tag: region.toUpperCase(),
      puuid: null,
      tier,
      division,
      lp: 99 - Math.floor((i / cantidad) * 100),
      victorias,
      derrotas: partidas - victorias,
      racha: al() < 0.12,
      veterano: al() < 0.2,
      nuevo: al() < 0.1,
      inactivo: al() < 0.05,
      cola,
    });
  }
  return jugadores;
}

async function obtenerListadoDemo(region, cola, tier, division, motivo) {
  demoEnMemoria ??= JSON.parse(await readFile(join(RAIZ, 'datos', 'ranking-lan.json'), 'utf8'));

  const jugadores = tier in TIERS_VALIDOS
    ? (demoEnMemoria.listados?.[`${cola}|${tier}`] ?? [])
    : listadoDemoMenor(region, cola, tier, division);

  return {
    esquema: 1,
    fuente: 'demo',
    aviso: motivo ?? demoEnMemoria.aviso,
    region: region.toUpperCase(),
    plataforma: region,
    cola,
    tier,
    division: tier in TIERS_VALIDOS ? 'I' : division,
    actualizado: demoEnMemoria.actualizado,
    total: jugadores.length,
    nombresPendientes: 0,
    jugadores,
  };
}

/* ==========================================================================
   Endpoint /api/ranking
   ========================================================================== */

async function manejarRanking(url, respuesta) {
  const region = regionDe(url);
  const cola = url.searchParams.get('cola') ?? 'RANKED_SOLO_5x5';
  const tier = (url.searchParams.get('tier') ?? 'CHALLENGER').toUpperCase();
  const division = (url.searchParams.get('division') ?? 'I').toUpperCase();

  if (!region) return json(respuesta, 400, { error: `Región no válida: ${url.searchParams.get('region')}` });
  if (!COLAS_VALIDAS.has(cola)) return json(respuesta, 400, { error: `Cola no válida: ${cola}` });
  if (!(tier in TIERS_VALIDOS) && !TIERS_MENORES.has(tier)) {
    return json(respuesta, 400, { error: `Liga no válida: ${tier}` });
  }
  if (TIERS_MENORES.has(tier) && !DIVISIONES.has(division)) {
    return json(respuesta, 400, { error: `División no válida: ${division}` });
  }

  const claveCache = `${region}|${cola}|${tier}|${division}`;
  const guardado = cacheListados.get(claveCache);
  if (guardado && Date.now() - guardado.momento < CONFIG.ttlMs) {
    // La cola de fondo sigue resolviendo nombres mientras el listado vive en
    // cache: se rellenan al servir, sin esperar a que caduque el TTL.
    return json(respuesta, 200, hidratarListado(guardado.valor, region), { 'X-Ranking-Cache': 'memoria' });
  }

  // Sin clave: servimos la demo. La PWA lo indica en la interfaz.
  if (!CONFIG.clave) {
    const demo = await obtenerListadoDemo(
      region, cola, tier, division,
      'No hay RIOT_API_KEY configurada en el servidor, así que estos son datos de ' +
      'demostración con Riot ID ficticios. Consulta el README para conectar la API real.',
    );
    return json(respuesta, 200, demo, { 'X-Ranking-Cache': 'demo' });
  }

  try {
    const listado = await obtenerListadoReal(region, cola, tier, division);
    cacheListados.set(claveCache, { valor: listado, momento: Date.now() });
    return json(respuesta, 200, listado, { 'X-Ranking-Cache': 'red' });
  } catch (error) {
    console.error(`[proxy] ranking ${claveCache}: ${error.message}`);

    // Si teniamos algo en cache, aunque este vencido, es mejor que un error.
    if (guardado) {
      return json(respuesta, 200, guardado.valor, { 'X-Ranking-Cache': 'vencida' });
    }

    // Ultimo recurso: la demo, explicando por que.
    const demo = await obtenerListadoDemo(
      region, cola, tier, division,
      `No se pudo consultar la API de Riot (${error.message}). Se muestran datos de demostración.`,
    );
    return json(respuesta, 200, demo, { 'X-Ranking-Cache': 'demo-por-error' });
  }
}

/* ==========================================================================
   Endpoint /api/jugador · seccion "Mi grupo"
   --------------------------------------------------------------------------
   Recibe un Riot ID (Nombre#TAG) y devuelve su rango en LAN en las dos colas.
   Con clave son 2 llamadas: account-v1 (Riot ID -> puuid, ruteo regional) y
   league-v4 entries/by-puuid (el rango en la plataforma). Sin clave se genera
   un rango ficticio pero DETERMINISTA: el mismo Riot ID produce siempre la
   misma liga, para que el grupo sea comparable y demostrable.
   ========================================================================== */

/** "Nombre#TAG" -> { nombre, tag } o null si el formato no es valido. */
function analizarRiotId(texto) {
  const pos = texto.lastIndexOf('#');
  if (pos <= 0) return null;
  const nombre = texto.slice(0, pos).trim();
  const tag = texto.slice(pos + 1).trim();
  if (nombre.length < 1 || nombre.length > 16 || nombre.includes('#')) return null;
  if (!/^[\p{L}\p{N}]{2,5}$/u.test(tag)) return null;
  return { nombre, tag };
}

/* --- Demo determinista ---------------------------------------------------- */

function hashCadena(texto) {
  let h = 5381;
  for (const c of texto) h = (Math.imul(h, 33) ^ c.codePointAt(0)) >>> 0;
  return h;
}

function crearAleatorio(semilla) {
  let s = semilla >>> 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Distribucion aproximada de un ladder real: la mayoria en ligas medias. */
const TIERS_DEMO = [
  ['IRON', 5], ['BRONZE', 11], ['SILVER', 17], ['GOLD', 20], ['PLATINUM', 17],
  ['EMERALD', 13], ['DIAMOND', 9], ['MASTER', 4], ['GRANDMASTER', 2], ['CHALLENGER', 2],
];
const TIERS_ALTOS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

function entradaDemo(riotId, cola) {
  const al = crearAleatorio(hashCadena(`${riotId.toLowerCase()}|${cola}`));

  // En flexible, una parte de los jugadores no tiene clasificacion.
  if (cola === 'RANKED_FLEX_SR' && al() < 0.3) return null;

  const total = TIERS_DEMO.reduce((n, [, peso]) => n + peso, 0);
  let resto = al() * total;
  let tier = 'GOLD';
  for (const [nombre, peso] of TIERS_DEMO) {
    resto -= peso;
    if (resto <= 0) { tier = nombre; break; }
  }

  const alto = TIERS_ALTOS.has(tier);
  const division = alto ? 'I' : ['I', 'II', 'III', 'IV'][Math.floor(al() * 4)];
  const lp = !alto
    ? Math.floor(al() * 100)
    : tier === 'MASTER' ? Math.floor(al() * 500)
    : tier === 'GRANDMASTER' ? 200 + Math.floor(al() * 600)
    : 600 + Math.floor(al() * 900);

  const partidas = 40 + Math.floor(al() * 360);
  const victorias = Math.round(partidas * (0.42 + al() * 0.2));

  return {
    tier,
    division,
    lp,
    victorias,
    derrotas: partidas - victorias,
    racha: al() < 0.15,
    veterano: al() < 0.25,
    nuevo: al() < 0.1,
    inactivo: al() < 0.05,
  };
}

/* --- El endpoint ---------------------------------------------------------- */

async function manejarJugador(url, respuesta) {
  const region = regionDe(url);
  if (!region) return json(respuesta, 400, { error: `Región no válida: ${url.searchParams.get('region')}` });

  const bruto = (url.searchParams.get('riotId') ?? '').trim();
  if (bruto.length > 40) return json(respuesta, 400, { error: 'Riot ID demasiado largo' });

  const partes = analizarRiotId(bruto);
  if (!partes) {
    return json(respuesta, 400, {
      error: 'Riot ID no válido. Usa el formato Nombre#TAG (el tag tiene de 2 a 5 letras o números).',
    });
  }
  const { nombre, tag } = partes;

  const claveCache = `jugador|${region}|${nombre.toLowerCase()}#${tag.toLowerCase()}`;
  const guardado = cacheListados.get(claveCache);
  if (guardado && Date.now() - guardado.momento < CONFIG.ttlMs) {
    return json(respuesta, 200, guardado.valor, { 'X-Ranking-Cache': 'memoria' });
  }

  // Sin clave: rango ficticio pero estable para cada Riot ID y region.
  if (!CONFIG.clave) {
    const riotId = `${nombre}#${tag.toUpperCase()}`;
    return json(respuesta, 200, {
      esquema: 1,
      fuente: 'demo',
      aviso: 'Sin RIOT_API_KEY en el servidor: los rangos del grupo son ficticios (aunque estables para cada Riot ID).',
      region: region.toUpperCase(),
      plataforma: region,
      riotId,
      puuid: null,
      actualizado: new Date().toISOString(),
      colas: {
        RANKED_SOLO_5x5: entradaDemo(`${region}|${riotId}`, 'RANKED_SOLO_5x5'),
        RANKED_FLEX_SR: entradaDemo(`${region}|${riotId}`, 'RANKED_FLEX_SR'),
      },
    }, { 'X-Ranking-Cache': 'demo' });
  }

  try {
    // 1. Riot ID -> puuid (account-v1, ruteo regional de la region elegida).
    const cuenta = await pedirARiot(
      `https://${REGIONES[region].cuenta}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/` +
      `${encodeURIComponent(nombre)}/${encodeURIComponent(tag)}`,
    );

    // 2. puuid -> entradas clasificatorias en la plataforma elegida (league-v4).
    const entradas = await pedirARiot(
      `https://${region}.api.riotgames.com/lol/league/v4/entries/by-puuid/` +
      encodeURIComponent(cuenta.puuid),
    );

    const colas = { RANKED_SOLO_5x5: null, RANKED_FLEX_SR: null };
    for (const entrada of entradas ?? []) {
      if (!(entrada.queueType in colas)) continue;
      colas[entrada.queueType] = {
        tier: entrada.tier ?? 'UNRANKED',
        division: entrada.rank ?? 'I',
        lp: entrada.leaguePoints ?? 0,
        victorias: entrada.wins ?? 0,
        derrotas: entrada.losses ?? 0,
        racha: Boolean(entrada.hotStreak),
        veterano: Boolean(entrada.veteran),
        nuevo: Boolean(entrada.freshBlood),
        inactivo: Boolean(entrada.inactive),
      };
    }

    const valor = {
      esquema: 1,
      fuente: 'vivo',
      region: region.toUpperCase(),
      plataforma: region,
      riotId: `${cuenta.gameName ?? nombre}#${cuenta.tagLine ?? tag.toUpperCase()}`,
      puuid: cuenta.puuid,
      actualizado: new Date().toISOString(),
      colas,
    };
    cacheListados.set(claveCache, { valor, momento: Date.now() });
    return json(respuesta, 200, valor, { 'X-Ranking-Cache': 'red' });
  } catch (error) {
    // Un 404 es informacion real (la cuenta no existe): nunca se tapa con demo.
    if (error.estado === 404) {
      return json(respuesta, 404, { error: `No existe la cuenta ${nombre}#${tag} en Riot.` });
    }

    console.error(`[proxy] jugador ${nombre}#${tag}: ${error.message}`);
    if (guardado) return json(respuesta, 200, guardado.valor, { 'X-Ranking-Cache': 'vencida' });
    return json(respuesta, error.estado === 429 ? 429 : 502, { error: error.message });
  }
}

/* ==========================================================================
   Endpoint /api/historial · mini historial de partidas (seccion "Mi grupo")
   --------------------------------------------------------------------------
   Con clave: match-v5 en el ruteo regional de la region (1 llamada por la
   lista de ids + 1 por partida). Sin clave: historial ficticio determinista.
   Se cachea por puuid+region durante el mismo TTL del resto.
   ========================================================================== */

const CAMPEONES_DEMO = [
  'Ahri', 'Yasuo', 'Jinx', 'Thresh', 'LeeSin', 'Lux', 'Zed', 'Ekko', 'Vi',
  'Caitlyn', 'Ezreal', 'Leona', 'Darius', 'Garen', 'Katarina', 'Ashe',
  'Morgana', 'Sett', 'Viego', 'Samira', 'KSante', 'Milio', 'Briar', 'Aurora',
];

function historialDemo(semillaTexto) {
  const al = crearAleatorio(hashCadena(`historial|${semillaTexto}`));
  const cuantas = 5 + Math.floor(al() * 2); // 5 o 6
  const partidas = [];
  let hace = 1 + al() * 5; // horas desde la ultima partida

  for (let i = 0; i < cuantas; i++) {
    const victoria = al() < 0.52;
    const muertes = 1 + Math.floor(al() * 9);
    const duracionSeg = Math.round((20 + al() * 18) * 60);
    partidas.push({
      campeon: CAMPEONES_DEMO[Math.floor(al() * CAMPEONES_DEMO.length)],
      victoria,
      k: Math.floor(al() * (victoria ? 14 : 9)),
      d: victoria ? Math.max(1, muertes - 3) : muertes,
      a: Math.floor(al() * 16),
      cs: Math.round((4 + al() * 4.5) * (duracionSeg / 60)),
      duracionSeg,
      cola: al() < 0.7 ? 420 : 440,
      posicion: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][Math.floor(al() * 5)],
      terminada: new Date(Date.now() - hace * 3600_000).toISOString(),
    });
    hace += 0.7 + al() * 30; // partidas cada vez mas antiguas
  }
  return partidas;
}

async function manejarHistorial(url, respuesta) {
  const region = regionDe(url);
  if (!region) return json(respuesta, 400, { error: `Región no válida: ${url.searchParams.get('region')}` });

  const puuid = (url.searchParams.get('puuid') ?? '').trim();
  // En modo demo los perfiles no tienen puuid: el riotId sirve de semilla.
  const semilla = puuid || (url.searchParams.get('riotId') ?? '').trim();
  if (!semilla) return json(respuesta, 400, { error: 'Falta puuid o riotId' });
  if (puuid && !/^[\w-]{20,100}$/.test(puuid)) {
    return json(respuesta, 400, { error: 'puuid no válido' });
  }

  const claveCache = `historial|${region}|${semilla.toLowerCase()}`;
  const guardado = cacheListados.get(claveCache);
  if (guardado && Date.now() - guardado.momento < CONFIG.ttlMs) {
    return json(respuesta, 200, guardado.valor, { 'X-Ranking-Cache': 'memoria' });
  }

  if (!CONFIG.clave || !puuid) {
    return json(respuesta, 200, {
      esquema: 1,
      fuente: 'demo',
      region: region.toUpperCase(),
      actualizado: new Date().toISOString(),
      partidas: historialDemo(`${region}|${semilla.toLowerCase()}`),
    }, { 'X-Ranking-Cache': 'demo' });
  }

  try {
    const ruteo = REGIONES[region].partidas;
    const ids = await pedirARiot(
      `https://${ruteo}.api.riotgames.com/lol/match/v5/matches/by-puuid/` +
      `${encodeURIComponent(puuid)}/ids?type=ranked&count=6`,
    );

    const detalles = await enLotes(ids ?? [], 3, (id) =>
      pedirARiot(`https://${ruteo}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(id)}`)
        .catch(() => null),
    );

    const partidas = [];
    for (const partida of detalles) {
      const yo = partida?.info?.participants?.find((p) => p.puuid === puuid);
      if (!yo) continue;
      partidas.push({
        campeon: yo.championName ?? '—',
        victoria: Boolean(yo.win),
        k: yo.kills ?? 0,
        d: yo.deaths ?? 0,
        a: yo.assists ?? 0,
        cs: (yo.totalMinionsKilled ?? 0) + (yo.neutralMinionsKilled ?? 0),
        duracionSeg: partida.info.gameDuration ?? 0,
        cola: partida.info.queueId ?? 0,
        posicion: yo.teamPosition || yo.individualPosition || '',
        terminada: partida.info.gameEndTimestamp
          ? new Date(partida.info.gameEndTimestamp).toISOString()
          : null,
      });
    }

    const valor = {
      esquema: 1,
      fuente: 'vivo',
      region: region.toUpperCase(),
      actualizado: new Date().toISOString(),
      partidas,
    };
    cacheListados.set(claveCache, { valor, momento: Date.now() });
    return json(respuesta, 200, valor, { 'X-Ranking-Cache': 'red' });
  } catch (error) {
    console.error(`[proxy] historial ${region}: ${error.message}`);
    if (guardado) return json(respuesta, 200, guardado.valor, { 'X-Ranking-Cache': 'vencida' });
    return json(respuesta, error.estado === 429 ? 429 : 502, { error: error.message });
  }
}

/* ==========================================================================
   Archivos estaticos
   ========================================================================== */

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function json(respuesta, estado, cuerpo, cabeceras = {}) {
  const texto = JSON.stringify(cuerpo);
  respuesta.writeHead(estado, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
    // El service worker es quien decide que guardar; el cache HTTP no debe
    // servir un ladder viejo por su cuenta.
    'Cache-Control': 'no-store',
    ...cabeceras,
  });
  respuesta.end(texto);
}

async function servirEstatico(rutaUrl, peticion, respuesta) {
  // Normalizamos y comprobamos que no se salga de la raiz del proyecto.
  const relativa = normalize(decodeURIComponent(rutaUrl)).replace(/^(\.\.[/\\])+/, '');
  let destino = join(RAIZ, relativa);

  if (!destino.startsWith(RAIZ + sep) && destino !== RAIZ) {
    return json(respuesta, 403, { error: 'Ruta no permitida' });
  }

  try {
    let info = await stat(destino);
    if (info.isDirectory()) {
      destino = join(destino, 'index.html');
      info = await stat(destino);
    }

    const tipo = TIPOS[extname(destino).toLowerCase()] ?? 'application/octet-stream';
    const esHtml = tipo.startsWith('text/html');

    respuesta.writeHead(200, {
      'Content-Type': tipo,
      'Content-Length': info.size,
      'Last-Modified': info.mtime.toUTCString(),
      // En desarrollo conviene no cachear el HTML ni el propio service worker.
      'Cache-Control': esHtml || destino.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600',
    });

    if (peticion.method === 'HEAD') return respuesta.end();
    createReadStream(destino).pipe(respuesta);
  } catch {
    respuesta.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    respuesta.end('404 · No encontrado');
  }
}

/* ==========================================================================
   Servidor
   ========================================================================== */

const servidor = createServer(async (peticion, respuesta) => {
  // Ojo: "//riot.txt" como referencia relativa es una URL relativa a protocolo
  // (el host seria "riot.txt" y la ruta "/"). Se colapsan las barras repetidas
  // del path ANTES de interpretar la URL; la verificacion del portal de Riot
  // pide exactamente https://dominio//riot.txt cuando la URL registrada
  // termina en barra.
  const crudo = peticion.url ?? '/';
  const pregunta = crudo.indexOf('?');
  const rutaColapsada =
    (pregunta === -1 ? crudo : crudo.slice(0, pregunta)).replace(/\/{2,}/g, '/');
  const consulta = pregunta === -1 ? '' : crudo.slice(pregunta);
  const url = new URL(rutaColapsada + consulta, `http://${peticion.headers.host ?? 'localhost'}`);

  if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
    return json(respuesta, 405, { error: 'Solo se admiten GET y HEAD' });
  }

  try {
    if (url.pathname === '/api/ranking') return await manejarRanking(url, respuesta);
    if (url.pathname === '/api/jugador') return await manejarJugador(url, respuesta);
    if (url.pathname === '/api/historial') return await manejarHistorial(url, respuesta);

    if (url.pathname === '/api/estado') {
      return json(respuesta, 200, {
        ok: true,
        claveConfigurada: Boolean(CONFIG.clave),
        plataforma: CONFIG.plataforma,
        regiones: Object.keys(REGIONES),
        top: CONFIG.top,
        ttlSegundos: CONFIG.ttlMs / 1000,
        listadosEnCache: [...cacheListados.keys()],
        nombresEnCache: cacheNombres.size,
        nombresEnCola: colaNombres.length,
        presupuesto: (() => {
          const { segundo, ventana } = usoActual();
          return {
            usadoUltimoSegundo: `${segundo}/${LIMITE_SEGUNDO}`,
            usadoVentana2min: `${ventana}/${LIMITE_VENTANA}`,
            reservaInteractiva: RESERVA_INTERACTIVA,
          };
        })(),
      });
    }

    const ruta = url.pathname === '/' ? '/index.html' : url.pathname;
    await servirEstatico(ruta, peticion, respuesta);
  } catch (error) {
    console.error('[proxy] error no controlado:', error);
    if (!respuesta.headersSent) json(respuesta, 500, { error: 'Error interno del servidor' });
    else respuesta.end();
  }
});

/**
 * Calentamiento: al arrancar (primera vez o tras un reinicio de la tarea) se
 * precargan los listados de la elite de la region por defecto SIN resolver
 * nombres en linea (nombresSincronos = 0): las listas cuestan 3 llamadas y
 * todos los nombres pasan a la cola de fondo, que usa el presupuesto libre.
 * Asi el primer visitante encuentra el ladder ya servido y los nombres
 * apareciendo, en vez de pagar el arranque en frio.
 */
async function calentarCache() {
  if (!CONFIG.clave) return;
  for (const tier of Object.keys(TIERS_VALIDOS)) {
    try {
      const listado = await obtenerListadoReal(CONFIG.plataforma, 'RANKED_SOLO_5x5', tier, 'I', 0);
      cacheListados.set(`${CONFIG.plataforma}|RANKED_SOLO_5x5|${tier}|I`, {
        valor: listado,
        momento: Date.now(),
      });
      console.log(`[proxy] calentado ${CONFIG.plataforma} ${tier}: ${listado.total} jugadores`);
    } catch (error) {
      console.warn(`[proxy] calentamiento ${tier}: ${error.message}`);
    }
  }
}

servidor.listen(CONFIG.puerto, () => {
  const linea = '─'.repeat(58);
  console.log(linea);
  console.log('  Ranking LAN · servidor de desarrollo');
  console.log(linea);
  console.log(`  App          http://localhost:${CONFIG.puerto}/`);
  console.log(`  Ranking      http://localhost:${CONFIG.puerto}/api/ranking?tier=CHALLENGER&cola=RANKED_SOLO_5x5`);
  console.log(`  Jugador      http://localhost:${CONFIG.puerto}/api/jugador?riotId=Nombre%23TAG`);
  console.log(`  Estado       http://localhost:${CONFIG.puerto}/api/estado`);
  console.log(linea);
  if (CONFIG.clave) {
    console.log(`  Clave de Riot detectada · plataforma ${CONFIG.plataforma} · top ${CONFIG.top}`);
    console.log(`  Presupuesto: ${LIMITE_SEGUNDO}/s y ${LIMITE_VENTANA}/2 min · reserva interactiva ${RESERVA_INTERACTIVA}`);
  } else {
    console.log('  Sin RIOT_API_KEY: se sirven datos de DEMOSTRACIÓN.');
    console.log('  Para datos reales:  RIOT_API_KEY=RGAPI-... node servidor/proxy.mjs');
  }
  console.log(linea);

  // El calentamiento corre despues de abrir el puerto: no bloquea el arranque
  // ni el health check del balanceador.
  calentarCache();
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    console.log('\nCerrando servidor…');
    servidor.close(() => process.exit(0));
  });
}

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
const TIERS_VALIDOS = {
  CHALLENGER: 'challengerleagues',
  GRANDMASTER: 'grandmasterleagues',
  MASTER: 'masterleagues',
};

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

async function pedirARiot(url) {
  if (Date.now() < esperarHasta) {
    const segundos = Math.ceil((esperarHasta - Date.now()) / 1000);
    throw new ErrorRiot(`Límite de peticiones activo, reintenta en ${segundos} s`, 429, segundos);
  }

  const respuesta = await fetch(url, {
    headers: { 'X-Riot-Token': CONFIG.clave, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (respuesta.status === 429) {
    const espera = Number(respuesta.headers.get('Retry-After') ?? 10);
    esperarHasta = Date.now() + espera * 1000;
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

/** Ejecuta tareas con un limite de concurrencia, para no disparar el rate limit. */
async function enLotes(elementos, tamanoLote, tarea) {
  const salida = [];
  for (let i = 0; i < elementos.length; i += tamanoLote) {
    const lote = elementos.slice(i, i + tamanoLote);
    salida.push(...(await Promise.all(lote.map(tarea))));
    // Pausa corta entre lotes: la clave de desarrollo permite 20 peticiones/s.
    if (i + tamanoLote < elementos.length) await new Promise((r) => setTimeout(r, 120));
  }
  return salida;
}

/** puuid -> Riot ID (gameName#tagLine) usando account-v1. */
async function resolverRiotId(puuid) {
  const guardado = cacheNombres.get(puuid);
  if (guardado && Date.now() - guardado.momento < TTL_NOMBRES_MS) return guardado.valor;

  try {
    const cuenta = await pedirARiot(
      `https://${CONFIG.region}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`,
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

/**
 * Descarga un listado real del ladder de LAN y lo normaliza a la forma que
 * espera la PWA (la misma que usa datos/ranking-lan.json).
 */
async function obtenerListadoReal(cola, tier, top) {
  const recurso = TIERS_VALIDOS[tier];
  const liga = await pedirARiot(
    `https://${CONFIG.plataforma}.api.riotgames.com/lol/league/v4/${recurso}/by-queue/${cola}`,
  );

  const entradas = [...(liga.entries ?? [])]
    .sort((a, b) => (b.leaguePoints ?? 0) - (a.leaguePoints ?? 0))
    .slice(0, top);

  // Riot ID en lotes de 5. summonerName quedo obsoleto en noviembre de 2023,
  // asi que el nombre visible se resuelve con account-v1 a partir del puuid.
  const nombres = await enLotes(entradas, 5, (entrada) =>
    entrada.puuid ? resolverRiotId(entrada.puuid) : Promise.resolve(null),
  );

  const jugadores = entradas.map((entrada, i) => {
    const identidad = nombres[i];
    const nombre = identidad?.nombre || entrada.summonerName || '';
    const tag = identidad?.tag || '';
    const etiqueta = nombre
      ? (tag ? `${nombre}#${tag}` : nombre)
      : `Invocador ${entrada.puuid ? entrada.puuid.slice(0, 6) : i + 1}`;

    return {
      puesto: i + 1,
      riotId: etiqueta,
      nombre: nombre || etiqueta,
      tag,
      puuid: entrada.puuid ?? null,
      tier: liga.tier ?? tier,
      division: entrada.rank ?? 'I',
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
    region: 'LAN',
    regionNombre: 'Latinoamérica Norte',
    plataforma: CONFIG.plataforma,
    cola,
    tier,
    liga: liga.name ?? null,
    actualizado: new Date().toISOString(),
    total: jugadores.length,
    jugadores,
  };
}

/* ==========================================================================
   Semilla de demostracion
   ========================================================================== */

let demoEnMemoria = null;

async function obtenerListadoDemo(cola, tier, top, motivo) {
  demoEnMemoria ??= JSON.parse(await readFile(join(RAIZ, 'datos', 'ranking-lan.json'), 'utf8'));

  const jugadores = (demoEnMemoria.listados?.[`${cola}|${tier}`] ?? []).slice(0, top);
  return {
    esquema: 1,
    fuente: 'demo',
    aviso: motivo ?? demoEnMemoria.aviso,
    region: 'LAN',
    regionNombre: 'Latinoamérica Norte',
    plataforma: CONFIG.plataforma,
    cola,
    tier,
    actualizado: demoEnMemoria.actualizado,
    total: jugadores.length,
    jugadores,
  };
}

/* ==========================================================================
   Endpoint /api/ranking
   ========================================================================== */

async function manejarRanking(url, respuesta) {
  const cola = url.searchParams.get('cola') ?? 'RANKED_SOLO_5x5';
  const tier = (url.searchParams.get('tier') ?? 'CHALLENGER').toUpperCase();
  const top = Math.min(Math.max(Number(url.searchParams.get('top')) || CONFIG.top, 1), 200);

  if (!COLAS_VALIDAS.has(cola)) return json(respuesta, 400, { error: `Cola no válida: ${cola}` });
  if (!(tier in TIERS_VALIDOS)) return json(respuesta, 400, { error: `Liga no válida: ${tier}` });

  const claveCache = `${cola}|${tier}|${top}`;
  const guardado = cacheListados.get(claveCache);
  if (guardado && Date.now() - guardado.momento < CONFIG.ttlMs) {
    return json(respuesta, 200, guardado.valor, { 'X-Ranking-Cache': 'memoria' });
  }

  // Sin clave: servimos la demo. La PWA lo indica en la interfaz.
  if (!CONFIG.clave) {
    const demo = await obtenerListadoDemo(
      cola, tier, top,
      'No hay RIOT_API_KEY configurada en el servidor, así que estos son datos de ' +
      'demostración con Riot ID ficticios. Consulta el README para conectar la API real.',
    );
    return json(respuesta, 200, demo, { 'X-Ranking-Cache': 'demo' });
  }

  try {
    const listado = await obtenerListadoReal(cola, tier, top);
    cacheListados.set(claveCache, { valor: listado, momento: Date.now() });
    return json(respuesta, 200, listado, { 'X-Ranking-Cache': 'red' });
  } catch (error) {
    console.error(`[proxy] ${error.message}`);

    // Si teniamos algo en cache, aunque este vencido, es mejor que un error.
    if (guardado) {
      return json(respuesta, 200, guardado.valor, { 'X-Ranking-Cache': 'vencida' });
    }

    // Ultimo recurso: la demo, explicando por que.
    const demo = await obtenerListadoDemo(
      cola, tier, top,
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
  const bruto = (url.searchParams.get('riotId') ?? '').trim();
  if (bruto.length > 40) return json(respuesta, 400, { error: 'Riot ID demasiado largo' });

  const partes = analizarRiotId(bruto);
  if (!partes) {
    return json(respuesta, 400, {
      error: 'Riot ID no válido. Usa el formato Nombre#TAG (el tag tiene de 2 a 5 letras o números).',
    });
  }
  const { nombre, tag } = partes;

  const claveCache = `jugador|${nombre.toLowerCase()}#${tag.toLowerCase()}`;
  const guardado = cacheListados.get(claveCache);
  if (guardado && Date.now() - guardado.momento < CONFIG.ttlMs) {
    return json(respuesta, 200, guardado.valor, { 'X-Ranking-Cache': 'memoria' });
  }

  // Sin clave: rango ficticio pero estable para cada Riot ID.
  if (!CONFIG.clave) {
    const riotId = `${nombre}#${tag.toUpperCase()}`;
    return json(respuesta, 200, {
      esquema: 1,
      fuente: 'demo',
      aviso: 'Sin RIOT_API_KEY en el servidor: los rangos del grupo son ficticios (aunque estables para cada Riot ID).',
      region: 'LAN',
      regionNombre: 'Latinoamérica Norte',
      plataforma: CONFIG.plataforma,
      riotId,
      puuid: null,
      actualizado: new Date().toISOString(),
      colas: {
        RANKED_SOLO_5x5: entradaDemo(riotId, 'RANKED_SOLO_5x5'),
        RANKED_FLEX_SR: entradaDemo(riotId, 'RANKED_FLEX_SR'),
      },
    }, { 'X-Ranking-Cache': 'demo' });
  }

  try {
    // 1. Riot ID -> puuid (account-v1, ruteo regional).
    const cuenta = await pedirARiot(
      `https://${CONFIG.region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/` +
      `${encodeURIComponent(nombre)}/${encodeURIComponent(tag)}`,
    );

    // 2. puuid -> entradas clasificatorias en la plataforma (league-v4).
    const entradas = await pedirARiot(
      `https://${CONFIG.plataforma}.api.riotgames.com/lol/league/v4/entries/by-puuid/` +
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
      region: 'LAN',
      regionNombre: 'Latinoamérica Norte',
      plataforma: CONFIG.plataforma,
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
  const url = new URL(peticion.url, `http://${peticion.headers.host ?? 'localhost'}`);

  if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
    return json(respuesta, 405, { error: 'Solo se admiten GET y HEAD' });
  }

  try {
    if (url.pathname === '/api/ranking') return await manejarRanking(url, respuesta);
    if (url.pathname === '/api/jugador') return await manejarJugador(url, respuesta);

    if (url.pathname === '/api/estado') {
      return json(respuesta, 200, {
        ok: true,
        claveConfigurada: Boolean(CONFIG.clave),
        plataforma: CONFIG.plataforma,
        top: CONFIG.top,
        ttlSegundos: CONFIG.ttlMs / 1000,
        listadosEnCache: [...cacheListados.keys()],
        nombresEnCache: cacheNombres.size,
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
    console.log('  Recuerda: las claves de desarrollo caducan cada 24 horas.');
  } else {
    console.log('  Sin RIOT_API_KEY: se sirven datos de DEMOSTRACIÓN.');
    console.log('  Para datos reales:  RIOT_API_KEY=RGAPI-... node servidor/proxy.mjs');
  }
  console.log(linea);
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    console.log('\nCerrando servidor…');
    servidor.close(() => process.exit(0));
  });
}

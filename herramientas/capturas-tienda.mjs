/**
 * Capturas de pantalla para el listado de la Microsoft Store (1920x1080).
 *
 * Arranca Chrome headless contra la app en PRODUCCION (datos reales de la API
 * de Riot, sin banner de demostracion), siembra localStorage con un grupo
 * formado por el top 3 real de LAN y el widget de ejemplo ANTES de cargar la
 * app, emula un escritorio de 1920x1080 y guarda en tienda/capturas/:
 *   01-ranking.png          vista global con podio y tabla
 *   02-perfil-grupo.png     Mi grupo con el detalle (historial y consejos) abierto
 *   03-campeones-build.png  Campeones con la ficha de un campeon y su build
 *   04-panel-widgets.png    panel de widgets con la tarjeta Top 3 pintada
 *   05-avisos.png           seccion Avisos y distintivos activada, con la
 *                           lista "Ultimos cambios" poblada con ejemplos
 *                           ilustrativos (Riot ID ficticios para el grupo y
 *                           el top 3 real para el ranking)
 * Falla (exit 1) si alguna captura no mide exactamente 1920x1080 o si la app
 * sirve datos de demostracion (chip «Datos demo»): las capturas de la Store no
 * deben llevar el banner de desarrollador. Para capturar igualmente contra un
 * proxy local sin RIOT_API_KEY, pasar --permitir-demo.
 *
 * Uso:  node herramientas/capturas-tienda.mjs [--url https://d3b4s9lb316i67.cloudfront.net/]
 *         [--cdp 9334] [--campeon 51] [--permitir-demo]
 *       (contra el proxy local: --url http://localhost:8137/ con el proxy en marcha)
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cdp, espera, lanzarChrome, paginaInicial } from './cdp.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(RAIZ, 'tienda', 'capturas');
const ANCHO = 1920;
const ALTO = 1080;

const flag = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : def;
};
const URL_APP = flag('url', 'https://d3b4s9lb316i67.cloudfront.net/');
const PUERTO_CDP = Number(flag('cdp', 9334));
/** Campeon de la captura 03 (id de Data Dragon). Por defecto Caitlyn: suele tener muestra amplia en la elite de LAN. */
const CAMPEON = String(flag('campeon', '51'));
const PERMITIR_DEMO = process.argv.includes('--permitir-demo');

/** Mismo orden de parametros que urlProxy() en js/api.js. */
const URL_RANKING = new URL('./api/ranking?region=la1&cola=RANKED_SOLO_5x5&tier=CHALLENGER&division=I', URL_APP);

/**
 * El grupo de las capturas es el top 3 real del ladder de LAN (los mismos
 * nombres del podio de la captura 01), asi "Mi grupo" muestra datos reales.
 */
async function grupoDesdeRanking() {
  const respuesta = await fetch(URL_RANKING, { headers: { Accept: 'application/json' } });
  if (!respuesta.ok) throw new Error(`${URL_RANKING.pathname} -> ${respuesta.status}`);
  const listado = await respuesta.json();
  const miembros = [...(listado.jugadores ?? [])]
    .sort((a, b) => (a.puesto ?? 0) - (b.puesto ?? 0))
    .map((j) => j.riotId)
    .filter((riotId) => typeof riotId === 'string' && riotId.includes('#'))
    .slice(0, 3);
  if (miembros.length < 3) throw new Error('El ranking no trae tres Riot ID resueltos para formar el grupo');
  return { miembros, fuente: listado.fuente };
}

const grupo = await grupoDesdeRanking();
console.log(`Grupo de las capturas (top 3 de LAN, fuente ${grupo.fuente}): ${grupo.miembros.join(', ')}`);

/** Estado inicial de la app para que las capturas muestren contenido. */
const SEMILLA = `
  localStorage.setItem('ranking-lan:grupo', ${JSON.stringify(JSON.stringify({
    miembros: grupo.miembros,
    cola: 'RANKED_SOLO_5x5',
  }))});
  localStorage.setItem('ranking-lan:widgets-instalados', ${JSON.stringify(JSON.stringify(['top3-lan']))});
  localStorage.setItem('ranking-lan:idioma', 'es');
  localStorage.setItem('ranking-lan:tema', 'oscuro');
`;

const { chrome, perfil } = lanzarChrome(PUERTO_CDP);
let cdp;
let codigoSalida = 0;

/** Espera hasta `intentos` x 250 ms a que la expresion sea verdadera. */
async function esperarA(expresion, intentos = 80) {
  for (let i = 0; i < intentos; i++) {
    try {
      if (await cdp.evaluar(expresion)) return;
    } catch { /* la pagina aun no esta lista */ }
    await espera(250);
  }
  throw new Error(`Se agotó la espera de: ${expresion}`);
}

const clic = (selector) => cdp.evaluar(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) throw new Error('No existe ' + ${JSON.stringify(selector)}); n.click(); return true; })()`);
const cerrarDialogo = () => cdp.evaluar(`(() => { const d = document.getElementById('dialogo'); if (d?.open) d.close(); return true; })()`);
const cerrarAvisos = () => cdp.evaluar(`(() => { const a = document.getElementById('avisos'); if (a) a.open = false; return true; })()`);

/**
 * Espera a que las imagenes VISIBLES dentro de `selector` hayan terminado de
 * cargar (retratos, objetos y runas de Data Dragon): sin esto la ficha sale
 * con recuadros vacios. Las imagenes son loading="lazy", asi que las que
 * quedan fuera del area visible no cargan nunca y no se esperan. Las que
 * fallan cuentan como terminadas.
 */
const esperarImagenes = (selector) => esperarA(`[...document.querySelectorAll(${JSON.stringify(selector)} + ' img')]
  .filter((img) => { const r = img.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; })
  .every((img) => img.complete)`, 60);

async function capturar(nombre) {
  await espera(400); // deja asentar transiciones y fuentes
  const { data } = await cdp.enviar('Page.captureScreenshot', { format: 'png' });
  const ruta = join(DESTINO, nombre);
  writeFileSync(ruta, Buffer.from(data, 'base64'));
  const cabecera = readFileSync(ruta);
  const ancho = cabecera.readUInt32BE(16);
  const alto = cabecera.readUInt32BE(20);
  if (ancho !== ANCHO || alto !== ALTO) {
    throw new Error(`${nombre} mide ${ancho}x${alto}, se esperaba ${ANCHO}x${ALTO}`);
  }
  console.log(`ok ${join('tienda', 'capturas', nombre)} ${ancho}x${alto}`);
}

/**
 * Puebla "Ultimos cambios" publicando al SW dos estados sucesivos (igual que
 * hace la pagina tras cada carga): la diferencia entre ambos genera los
 * avisos. El primero (la linea base) se publica ANTES de activar los avisos:
 * el SW actualiza su instantanea pero no anota nada; el segundo, ya
 * activados, produce exactamente una entrada por cambio. Grupo: Riot ID
 * ficticios (no se atribuyen cambios a jugadores reales). Ranking: el top 3
 * real que ya esta en pantalla, en otro orden en la base y en el real
 * despues, para que el texto liste a los jugadores reales.
 */
/**
 * El widget (04) y los avisos (05) nacen en el service worker: sin el, el
 * panel cae a los datos estaticos del paquete («Datos de demostración»). Si la
 * instalacion de la carga fallo, se registra de nuevo (la propia pagina ya
 * reintenta desde js/registro-sw.js; esto es un respaldo) y se espera a que
 * controle la pagina. Un register() rechazado por la misma interrupcion de la
 * primera visita no aborta la espera: se vuelve a intentar en la siguiente vuelta.
 */
async function asegurarServiceWorker() {
  const sw = await cdp.evaluar(`(async () => {
    const limite = Date.now() + 30000;
    let reintentos = 0;
    while (Date.now() < limite) {
      if (navigator.serviceWorker.controller) return { listo: true, reintentos };
      const registro = await navigator.serviceWorker.getRegistration();
      const enCurso = registro && (registro.installing || registro.waiting || registro.active);
      if (!enCurso) { // la instalacion fallo (registro borrado): volver a intentarlo
        reintentos++;
        try {
          await navigator.serviceWorker.register('./sw.js', { scope: './' });
        } catch { /* interrupcion de la primera visita: se reintenta en la siguiente vuelta */ }
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return { listo: false, reintentos };
  })()`);
  if (!sw.listo) throw new Error('el service worker no llegó a controlar la página');
  if (sw.reintentos > 0) console.warn(`aviso: el service worker no quedó instalado en la primera carga; se registró de nuevo (${sw.reintentos} reintento/s)`);
}

async function poblarUltimosCambios() {
  // Publica un estado al SW y espera a que lo procese (AVISOS_PENDIENTES 'datos').
  await cdp.evaluar(`(() => {
    const nombres = ${JSON.stringify(grupo.miembros)}; // top 3 real, el mismo del podio
    const ranking = (orden) => ({
      clave: 'la1|RANKED_SOLO_5x5|CHALLENGER|I', region: 'la1', cola: 'RANKED_SOLO_5x5', tier: 'CHALLENGER', division: 'I',
      top3: orden.map((i) => ({ clave: 'p' + i, riotId: nombres[i], lp: 3900 - i * 200 })),
    });
    const ficticios = (estados) => ({
      region: 'la1', cola: 'RANKED_SOLO_5x5',
      miembros: estados.map(([riotId, tier, division, lp]) => ({ riotId, tier, division, lp })),
    });
    window.__publicar = async (estados, orden) => {
      const reg = await navigator.serviceWorker.ready;
      const sw = navigator.serviceWorker.controller ?? reg.active;
      const llegada = new Promise((resolver) => {
        const alRecibir = (e) => {
          if (e.data?.tipo === 'AVISOS_PENDIENTES' && e.data.origen === 'datos') {
            navigator.serviceWorker.removeEventListener('message', alRecibir);
            resolver(e.data);
          }
        };
        navigator.serviceWorker.addEventListener('message', alRecibir);
      });
      sw.postMessage({ tipo: 'AVISOS_DATOS', grupo: ficticios(estados), ranking: ranking(orden) });
      return llegada;
    };
  })()`);
  // Linea base, con los avisos aun desactivados: solo fija la instantanea.
  await cdp.evaluar(`window.__publicar([['VicunaSereno#LAN1', 'DIAMOND', 'II', 71], ['SelvaSilente#BOG', 'EMERALD', 'II', 45], ['IguanaTitan9#ARG', 'PLATINUM', 'I', 88]], [1, 0, 2])`);

  await cdp.enviar('Browser.grantPermissions', { origin: new URL(URL_APP).origin, permissions: ['notifications'] });
  await clic('#avisos-activar');
  await esperarA(`document.getElementById('avisos-interruptor').checked === true`, 40);
  // Estado nuevo, ya activados: una entrada por cambio (tres del grupo y el top 3 real).
  await cdp.evaluar(`window.__publicar([['VicunaSereno#LAN1', 'DIAMOND', 'I', 12], ['SelvaSilente#BOG', 'EMERALD', 'II', 68], ['IguanaTitan9#ARG', 'EMERALD', 'IV', 5]], [0, 1, 2])`);
  await esperarA(`document.querySelectorAll('#avisos-lista li').length === 4`, 40);
}

try {
  mkdirSync(DESTINO, { recursive: true });
  const objetivo = await paginaInicial(PUERTO_CDP);
  cdp = await Cdp.conectar(objetivo.webSocketDebuggerUrl);

  await cdp.enviar('Runtime.enable');
  await cdp.enviar('Page.enable');
  await cdp.enviar('Page.addScriptToEvaluateOnNewDocument', { source: SEMILLA });
  await cdp.enviar('Emulation.setDeviceMetricsOverride', {
    width: ANCHO, height: ALTO, deviceScaleFactor: 1, mobile: false,
  });

  // Visita previa al origen, como un usuario que ya estuvo antes. En un perfil
  // recien creado la PRIMERA navegacion al origen en produccion hace que la
  // instalacion del service worker falle a menudo en Chrome («ServiceWorker
  // failed to install: Operation has failed (unknown reason)», ~470 ms despues
  // de register()); con una visita anterior instala siempre. La captura 05
  // necesita el SW activo (los avisos nacen en el).
  await cdp.enviar('Page.navigate', { url: `${URL_APP}privacidad.html` });
  await esperarA(`document.readyState === 'complete'`, 40);

  /* 01 · Ranking --------------------------------------------------------- */
  await cdp.enviar('Page.navigate', { url: `${URL_APP}?vista=global` });
  await esperarA(`document.querySelectorAll('#cuerpo-tabla tr:not(.esqueleto)').length > 0
    && document.querySelectorAll('#podio .podio__tarjeta').length === 3
    && document.getElementById('chip-fuente').dataset.fuente !== 'cargando'`);
  const fuente = await cdp.evaluar(`document.getElementById('chip-fuente').dataset.fuente`);
  const avisoDemoVisible = await cdp.evaluar(`!document.getElementById('aviso-demo').hidden`);
  if ((fuente === 'demo' || avisoDemoVisible) && !PERMITIR_DEMO) {
    throw new Error(`la app sirve datos de demostración (chip «${fuente}»); usa --url con un servidor con RIOT_API_KEY o --permitir-demo`);
  }
  console.log(`Fuente de los datos: ${fuente} · banner de demo ${avisoDemoVisible ? 'visible' : 'oculto'}`);
  await asegurarServiceWorker();
  await cerrarAvisos();
  await capturar('01-ranking.png');

  /* 02 · Perfil de un integrante de Mi grupo ------------------------------ */
  await clic('#tab-grupo');
  await esperarA(`document.querySelectorAll('#grupo-cuerpo tr[data-riot-id]').length === 3
    && !document.querySelector('#grupo-cuerpo tr.esqueleto')
    && [...document.querySelectorAll('#grupo-cuerpo .rango')].every((r) => r.dataset.tier)`);
  await espera(500);
  await clic('#grupo-cuerpo tr[data-riot-id]');
  await esperarA(`document.querySelectorAll('#dialogo-extra .historial__partida').length > 0
    && document.querySelectorAll('#dialogo-extra .consejos__item').length > 0`, 120);
  await esperarImagenes('#dialogo');
  await capturar('02-perfil-grupo.png');

  /* 03 · Campeones y build ------------------------------------------------ */
  await cerrarDialogo();
  await clic('#tab-campeones');
  await esperarA(`document.querySelectorAll('.cat-tarjeta').length > 100`);
  await clic(`.cat-tarjeta[data-id="${CAMPEON}"]`);
  await esperarA(`document.querySelectorAll('#dialogo-extra .build__conjunto .item').length > 0`, 160);
  await esperarImagenes('#dialogo');
  await capturar('03-campeones-build.png');

  /* 04 · Panel de widgets ------------------------------------------------- */
  await cerrarDialogo();
  await clic('#tab-global');
  await clic('#control-widgets');
  // La tarjeta debe pintarse con los datos del SW (en vivo), no con los
  // estaticos del paquete.
  await esperarA(`document.querySelectorAll('.pw-tarjeta .ac-accion').length > 0
    && !/demostraci/i.test(document.querySelector('.pw-tarjeta')?.textContent ?? '')`, 80);
  await capturar('04-panel-widgets.png');

  /* 05 · Avisos y distintivos -------------------------------------------- */
  await cdp.evaluar(`(() => { document.querySelector('.pw-panel')?.close?.(); return true; })()`);
  await poblarUltimosCambios();
  // behavior 'instant': el CSS tiene scroll-behavior: smooth y con 200 filas
  // la animacion tardaria mas que la espera, dejando la tabla en la captura.
  await cdp.evaluar(`(() => { const a = document.getElementById('avisos'); a.open = true; a.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
  await esperarA(`(() => { const r = document.getElementById('avisos').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`, 20);
  await capturar('05-avisos.png');
} catch (error) {
  console.error('\nNo se pudieron generar las capturas:', error.message);
  codigoSalida = 1;
} finally {
  cdp?.cerrar();
  chrome.kill('SIGKILL');
  await espera(300);
  rmSync(perfil, { recursive: true, force: true });
  process.exit(codigoSalida);
}

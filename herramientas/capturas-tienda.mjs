/**
 * Capturas de pantalla para el listado de la Microsoft Store (1920x1080).
 *
 * Arranca Chrome headless, siembra localStorage con un grupo y un widget de
 * ejemplo ANTES de cargar la app, emula un escritorio de 1920x1080 y guarda
 * en tienda/capturas/:
 *   01-ranking.png          vista global con podio y tabla
 *   02-perfil-grupo.png     Mi grupo con el detalle (historial y consejos) abierto
 *   03-campeones-build.png  Campeones con la ficha de Ahri y su build
 *   04-panel-widgets.png    panel de widgets con la tarjeta Top 3 pintada
 *   05-avisos.png           seccion Avisos y distintivos abierta
 * Falla (exit 1) si alguna captura no mide exactamente 1920x1080.
 *
 * Requiere el proxy en marcha: node servidor/proxy.mjs --puerto 8137
 * Uso:  node herramientas/capturas-tienda.mjs [--url http://localhost:8137/] [--cdp 9334]
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
const URL_APP = flag('url', 'http://localhost:8137/');
const PUERTO_CDP = Number(flag('cdp', 9334));

/** Estado inicial de la app para que las capturas muestren contenido. */
const SEMILLA = `
  localStorage.setItem('ranking-lan:grupo', ${JSON.stringify(JSON.stringify({
    miembros: ['VicunaSereno#LAN1', 'IguanaTitan9#ARG', 'SelvaSilente#BOG'],
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

  /* 01 · Ranking --------------------------------------------------------- */
  await cdp.enviar('Page.navigate', { url: `${URL_APP}?vista=global` });
  await esperarA(`document.querySelectorAll('#cuerpo-tabla tr:not(.esqueleto)').length > 0
    && document.querySelectorAll('#podio .podio__tarjeta').length === 3`);
  await cerrarAvisos();
  await capturar('01-ranking.png');

  /* 02 · Perfil de un integrante de Mi grupo ------------------------------ */
  await clic('#tab-grupo');
  await esperarA(`document.querySelectorAll('#grupo-cuerpo tr[data-riot-id]').length === 3
    && !document.querySelector('#grupo-cuerpo tr.esqueleto')`);
  await espera(500);
  await clic('#grupo-cuerpo tr[data-riot-id]');
  await esperarA(`document.querySelectorAll('#dialogo-extra .historial__partida').length > 0
    && document.querySelectorAll('#dialogo-extra .consejos__item').length > 0`);
  await capturar('02-perfil-grupo.png');

  /* 03 · Campeones y build de Ahri --------------------------------------- */
  await cerrarDialogo();
  await clic('#tab-campeones');
  await esperarA(`document.querySelectorAll('.cat-tarjeta').length > 100`);
  await clic('.cat-tarjeta[data-id="103"]');
  await esperarA(`document.querySelectorAll('#dialogo-extra .build__conjunto .item').length > 0`);
  await capturar('03-campeones-build.png');

  /* 04 · Panel de widgets ------------------------------------------------- */
  await cerrarDialogo();
  await clic('#tab-global');
  await clic('#control-widgets');
  await esperarA(`document.querySelectorAll('.pw-tarjeta .ac-accion').length > 0`);
  await capturar('04-panel-widgets.png');

  /* 05 · Avisos y distintivos -------------------------------------------- */
  await cdp.evaluar(`(() => { document.querySelector('.pw-panel')?.close?.(); return true; })()`);
  await cdp.evaluar(`(() => { const a = document.getElementById('avisos'); a.open = true; a.scrollIntoView({ block: 'center' }); return true; })()`);
  await espera(300);
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

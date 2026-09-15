/**
 * Verificacion automatica de la PWA con Chrome DevTools Protocol.
 * Sin dependencias: usa el WebSocket nativo de Node (>= 22).
 *
 * Comprueba en un navegador real que:
 *   - la pagina carga sin excepciones ni errores de consola
 *   - el manifest es valido y tiene iconos
 *   - el service worker se registra y precachea el app shell
 *   - la tabla y el podio se pintan con datos
 *   - la app sigue funcionando offline (segunda carga sin red)
 *
 * Ademas captura las dos imagenes que declara manifest.webmanifest
 * (screenshots), usadas por Android para enriquecer el dialogo de instalacion.
 *
 * Uso:  node herramientas/verificar.mjs [--url http://localhost:8137/]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const flag = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : def;
};
const URL_APP = flag('url', 'http://localhost:8137/');
const PUERTO_CDP = Number(flag('cdp', 9333));

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================
   Cliente CDP minimo
   ================================================================ */
class Cdp {
  #ws; #id = 0; #pendientes = new Map();
  eventos = [];

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (e) => {
      const mensaje = JSON.parse(e.data);
      if (mensaje.id !== undefined) {
        const pendiente = this.#pendientes.get(mensaje.id);
        this.#pendientes.delete(mensaje.id);
        mensaje.error ? pendiente?.rechazar(new Error(mensaje.error.message)) : pendiente?.resolver(mensaje.result);
      } else {
        this.eventos.push(mensaje);
      }
    });
  }

  static async conectar(url) {
    const ws = new WebSocket(url);
    await new Promise((resolver, rechazar) => {
      ws.addEventListener('open', resolver, { once: true });
      ws.addEventListener('error', () => rechazar(new Error('No se pudo abrir el WebSocket de CDP')), { once: true });
    });
    return new Cdp(ws);
  }

  enviar(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolver, rechazar) => {
      this.#pendientes.set(id, { resolver, rechazar });
      this.#ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.#pendientes.delete(id)) rechazar(new Error(`Tiempo agotado en ${method}`));
      }, 30_000);
    });
  }

  /** Evalua JS en la pagina y devuelve el valor ya deserializado. */
  async evaluar(expresion) {
    const { result, exceptionDetails } = await this.enviar('Runtime.evaluate', {
      expression: expresion,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'Error al evaluar');
    return result.value;
  }

  cerrar() { this.#ws.close(); }
}

/* ================================================================
   Informe
   ================================================================ */
const resultados = [];
const comprobar = (nombre, ok, detalle = '') => {
  resultados.push({ nombre, ok, detalle });
  console.log(`  ${ok ? '✓' : '✗'}  ${nombre}${detalle ? `  ${detalle}` : ''}`);
};

/* ================================================================
   Principal
   ================================================================ */
const perfil = mkdtempSync(join(tmpdir(), 'ranking-lan-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PUERTO_CDP}`,
  `--user-data-dir=${perfil}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' });

let cdp;
let codigoSalida = 0;

try {
  /* --- Localizar el target de la pagina ------------------------------- */
  let objetivo;
  for (let intento = 0; intento < 60; intento++) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json();
      objetivo = lista.find((t) => t.type === 'page');
      if (objetivo?.webSocketDebuggerUrl) break;
    } catch { /* Chrome aun no escucha */ }
    await espera(250);
  }
  if (!objetivo) throw new Error('Chrome no expuso ningún target de página');

  cdp = await Cdp.conectar(objetivo.webSocketDebuggerUrl);

  await cdp.enviar('Runtime.enable');
  await cdp.enviar('Log.enable');
  await cdp.enviar('Page.enable');
  await cdp.enviar('Network.enable');

  /* --- Primera carga (con red) ---------------------------------------- */
  console.log(`\nCargando ${URL_APP}\n`);
  await cdp.enviar('Page.navigate', { url: URL_APP });

  // Esperamos a que la tabla tenga filas reales (no el esqueleto).
  let filas = 0;
  for (let intento = 0; intento < 80; intento++) {
    await espera(250);
    try {
      filas = await cdp.evaluar(
        `document.querySelectorAll('#cuerpo-tabla tr:not(.esqueleto)').length`,
      );
      if (filas > 0) break;
    } catch { /* la pagina puede estar navegando todavia */ }
  }

  console.log('Estructura y datos');
  comprobar('La tabla se pinta con filas', filas > 0, `${filas} filas`);
  comprobar('El podio muestra 3 tarjetas',
    (await cdp.evaluar(`document.querySelectorAll('#podio .podio__tarjeta').length`)) === 3);

  const metricas = await cdp.evaluar(`({
    total: document.getElementById('m-total').textContent,
    lpMax: document.getElementById('m-lp-max').textContent,
    lpMin: document.getElementById('m-lp-min').textContent,
    wr: document.getElementById('m-winrate').textContent,
  })`);
  comprobar('Las métricas del resumen tienen valores',
    metricas.total !== '–' && metricas.lpMax !== '–',
    `${metricas.total} jugadores · máx ${metricas.lpMax} LP · mín ${metricas.lpMin} · WR ${metricas.wr}`);

  const chipFuente = await cdp.evaluar(`document.getElementById('chip-fuente').dataset.fuente`);
  comprobar('El chip de fuente refleja el origen de los datos',
    ['vivo', 'demo', 'cache'].includes(chipFuente), chipFuente);

  const avisoVisible = await cdp.evaluar(`!document.getElementById('aviso-demo').hidden`);
  comprobar('El aviso de demo aparece solo en modo demo', avisoVisible === (chipFuente === 'demo'),
    avisoVisible ? 'visible' : 'oculto');

  // El atributo hidden se anula si el CSS declara un display propio: comprobamos
  // que los elementos ocultos esten realmente fuera de la pantalla.
  const ocultos = await cdp.evaluar(`(() => {
    const invisible = (id) => {
      const n = document.getElementById(id);
      return !n || getComputedStyle(n).display === 'none';
    };
    return { toast: invisible('toast-actualizacion'), cargando: invisible('cargando'),
             vacio: invisible('mensaje-vacio') };
  })()`);
  comprobar('El atributo hidden oculta de verdad (toast, spinner, vacío)',
    ocultos.toast && ocultos.cargando && ocultos.vacio, JSON.stringify(ocultos));

  /* --- Filtros --------------------------------------------------------- */
  console.log('\nInteracción');
  const busqueda = await cdp.evaluar(`(async () => {
    const campo = document.getElementById('campo-buscar');
    const primero = document.querySelector('#cuerpo-tabla .jugador__nombre').textContent;
    campo.value = primero.slice(0, 5);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const visibles = document.querySelectorAll('#cuerpo-tabla tr').length;
    campo.value = '';
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    return { termino: primero.slice(0, 5), visibles, restauradas: document.querySelectorAll('#cuerpo-tabla tr').length };
  })()`);
  comprobar('La búsqueda filtra y se puede limpiar',
    busqueda.visibles >= 1 && busqueda.visibles < busqueda.restauradas,
    `"${busqueda.termino}" -> ${busqueda.visibles}, limpio -> ${busqueda.restauradas}`);

  const cambioTier = await cdp.evaluar(`(async () => {
    const sel = document.getElementById('sel-tier');
    sel.value = 'GRANDMASTER';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 150));
      const t = document.getElementById('titulo-tabla').textContent;
      if (t.includes('Gran Maestro') && document.querySelectorAll('#cuerpo-tabla tr:not(.esqueleto)').length) return t;
    }
    return document.getElementById('titulo-tabla').textContent;
  })()`);
  comprobar('Cambiar de liga recarga el listado', cambioTier.includes('Gran Maestro'), cambioTier);

  const todas = await cdp.evaluar(
    `document.querySelectorAll('#cuerpo-tabla tr:not(.esqueleto)').length`);
  comprobar('El listado muestra a todos los jugadores (sin tope de 25)', todas >= 40, `${todas} filas`);

  const cambioRegion = await cdp.evaluar(`(async () => {
    const sel = document.getElementById('sel-region');
    sel.value = 'na1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 150));
      const t = document.getElementById('titulo-tabla').textContent;
      if (t.includes('NA') && document.querySelectorAll('#cuerpo-tabla tr:not(.esqueleto)').length) return t;
    }
    return document.getElementById('titulo-tabla').textContent;
  })()`);
  comprobar('Cambiar de región recarga el listado', cambioRegion.includes('NA'), cambioRegion);

  const ligaMenor = await cdp.evaluar(`(async () => {
    const sel = document.getElementById('sel-tier');
    sel.value = 'GOLD';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 150));
      if (!document.getElementById('control-division').hidden
          && document.querySelectorAll('#cuerpo-tabla tr:not(.esqueleto)').length > 0
          && document.getElementById('titulo-tabla').textContent.includes('Oro')) break;
    }
    return {
      division: !document.getElementById('control-division').hidden,
      filas: document.querySelectorAll('#cuerpo-tabla tr:not(.esqueleto)').length,
      titulo: document.getElementById('titulo-tabla').textContent,
    };
  })()`);
  comprobar('Las ligas bajo Maestro cargan con selector de división',
    ligaMenor.division && ligaMenor.filas > 0, `${ligaMenor.titulo} · ${ligaMenor.filas} filas`);

  // Vuelta al estado base (LAN + Retador) para el resto de comprobaciones.
  await cdp.evaluar(`(async () => {
    const region = document.getElementById('sel-region');
    region.value = 'la1';
    region.dispatchEvent(new Event('change', { bubbles: true }));
    const tier = document.getElementById('sel-tier');
    tier.value = 'CHALLENGER';
    tier.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 150));
      if (document.getElementById('titulo-tabla').textContent.includes('Retador')
          && document.querySelectorAll('#cuerpo-tabla tr:not(.esqueleto)').length) break;
    }
  })()`);

  /* --- Idiomas ---------------------------------------------------------- */
  console.log('\nIdiomas');
  const ingles = await cdp.evaluar(`(async () => {
    const sel = document.getElementById('sel-idioma');
    sel.value = 'en';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 350));
    return {
      tab: document.querySelector('#tab-global [data-i18n]').textContent,
      th: document.querySelector('.tabla th.col-wr').textContent,
      titulo: document.getElementById('titulo-tabla').textContent,
    };
  })()`);
  comprobar('La interfaz cambia a inglés sin recargar',
    ingles.tab === 'Regional ranking' && ingles.th === 'Win rate',
    `${ingles.tab} · ${ingles.titulo}`);

  const espanol = await cdp.evaluar(`(async () => {
    const sel = document.getElementById('sel-idioma');
    sel.value = 'es';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 350));
    return document.querySelector('#tab-global [data-i18n]').textContent;
  })()`);
  comprobar('Y vuelve a español', espanol === 'Ranking regional', espanol);

  const detalle = await cdp.evaluar(`(async () => {
    document.querySelector('#cuerpo-tabla button[data-accion="detalle"]').click();
    await new Promise(r => setTimeout(r, 200));
    const d = document.getElementById('dialogo');
    const abierto = d.open;
    const titulo = document.getElementById('dialogo-titulo').textContent;
    const campos = document.querySelectorAll('#dialogo-datos dt').length;
    d.close();
    return { abierto, titulo, campos };
  })()`);
  comprobar('El diálogo de detalle abre con datos',
    detalle.abierto && detalle.campos >= 5, `${detalle.titulo} · ${detalle.campos} campos`);

  /* --- Mi grupo --------------------------------------------------------- */
  console.log('\nMi grupo');

  await cdp.evaluar(`document.getElementById('tab-grupo').click()`);
  comprobar('La pestaña «Mi grupo» activa su panel',
    await cdp.evaluar(
      `!document.getElementById('vista-grupo').hidden && document.getElementById('vista-global').hidden`,
    ));
  comprobar('El estado vacío se muestra sin integrantes',
    await cdp.evaluar(`getComputedStyle(document.getElementById('grupo-vacio')).display !== 'none'`));

  const agregarAmigo = (nombre, tag, esperadas) => cdp.evaluar(`(async () => {
    document.getElementById('campo-nombre').value = ${JSON.stringify(nombre)};
    document.getElementById('campo-tag').value = ${JSON.stringify(tag)};
    document.getElementById('form-amigo').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 150));
      if (document.querySelectorAll('#grupo-cuerpo tr').length === ${esperadas}
          && !document.getElementById('btn-agregar').disabled) break;
    }
    return {
      filas: document.querySelectorAll('#grupo-cuerpo tr').length,
      mensaje: document.getElementById('grupo-mensaje').textContent,
    };
  })()`);

  const alta1 = await agregarAmigo('PruebaUno', 'LAN', 1);
  comprobar('Se puede agregar un amigo con nombre y tag separados', alta1.filas === 1, alta1.mensaje);

  const ligaAmigo = await cdp.evaluar(
    `document.querySelector('#grupo-cuerpo .rango')?.textContent ?? ''`);
  comprobar('Cada fila muestra su liga', ligaAmigo.length > 0, ligaAmigo);

  const alta2 = await agregarAmigo('OtroAmigo', 'MX1', 2);
  comprobar('Se puede agregar un segundo amigo', alta2.filas === 2, alta2.mensaje);

  const puntosGrupo = await cdp.evaluar(
    `[...document.querySelectorAll('#grupo-cuerpo tr')].map(f => Number(f.dataset.puntos))`);
  comprobar('El grupo queda ordenado por rango descendente',
    puntosGrupo.every((v, i) => i === 0 || v <= puntosGrupo[i - 1]), puntosGrupo.join(' ≥ '));

  const duplicado = await agregarAmigo('pruebauno', 'lan', 2);
  comprobar('Rechaza Riot ID duplicados (sin distinguir mayúsculas)',
    duplicado.filas === 2 && /ya está/i.test(duplicado.mensaje), duplicado.mensaje);

  const invalido = await agregarAmigo('Nombre', 'X', 2);
  comprobar('Valida el tag por separado',
    invalido.filas === 2 && /tag/i.test(invalido.mensaje), invalido.mensaje);

  const detalleGrupo = await cdp.evaluar(`(async () => {
    document.querySelector('#grupo-cuerpo tr').click();
    // El historial llega asincrono (match-v5 via proxy): esperamos a que pinte.
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (document.querySelectorAll('#dialogo-extra .historial__partida').length > 0) break;
    }
    const d = document.getElementById('dialogo');
    const resultado = {
      abierto: d.open,
      titulo: document.getElementById('dialogo-titulo').textContent,
      partidas: document.querySelectorAll('#dialogo-extra .historial__partida').length,
      consejos: document.querySelectorAll('#dialogo-extra .consejos__item').length,
      comparacion: document.querySelectorAll('#dialogo-extra .comparacion dt').length,
      centrado: (() => {
        const caja = d.getBoundingClientRect();
        return Math.abs((innerWidth - caja.width) / 2 - caja.left) < 40;
      })(),
    };
    d.close();
    return resultado;
  })()`);
  comprobar('El detalle del grupo abre centrado y con historial de partidas',
    detalleGrupo.abierto && detalleGrupo.titulo.includes('#') &&
    detalleGrupo.partidas >= 3 && detalleGrupo.centrado,
    `${detalleGrupo.titulo} · ${detalleGrupo.partidas} partidas`);
  comprobar('Incluye consejos y comparación contra el grupo',
    detalleGrupo.consejos >= 1 && detalleGrupo.comparacion >= 2,
    `${detalleGrupo.consejos} consejos · ${detalleGrupo.comparacion} métricas comparadas`);

  /* Persistencia real: recarga completa de la pagina. */
  await cdp.enviar('Page.navigate', { url: URL_APP + '?vista=grupo' });
  let filasTrasRecarga = 0;
  for (let i = 0; i < 60; i++) {
    await espera(250);
    try {
      filasTrasRecarga = await cdp.evaluar(
        `document.getElementById('vista-grupo') && !document.getElementById('vista-grupo').hidden
           ? document.querySelectorAll('#grupo-cuerpo tr').length : 0`);
      if (filasTrasRecarga === 2) break;
    } catch { /* navegando */ }
  }
  comprobar('El grupo persiste tras recargar (localStorage)', filasTrasRecarga === 2,
    `${filasTrasRecarga} filas tras recargar con ?vista=grupo`);

  const quedan = await cdp.evaluar(`(async () => {
    document.querySelector('#grupo-cuerpo .btn-quitar').click();
    await new Promise(r => setTimeout(r, 250));
    return document.querySelectorAll('#grupo-cuerpo tr').length;
  })()`);
  comprobar('Quitar un integrante actualiza tabla y almacenamiento', quedan === 1,
    `${quedan} fila restante`);

  comprobar('El botón «Compartir grupo» está disponible',
    await cdp.evaluar(
      `!!document.getElementById('btn-grupo-compartir') && !document.getElementById('btn-grupo-compartir').disabled`,
    ));

  /* Importacion por enlace compartido: 1 miembro actual + 2 invitados = 3. */
  await cdp.enviar('Page.navigate', { url: URL_APP + '?amigos=Invitada%23PER,Invitado%23CRC' });
  let importe = { filas: 0, vista: false };
  for (let i = 0; i < 60; i++) {
    await espera(250);
    try {
      importe = await cdp.evaluar(`({
        filas: document.querySelectorAll('#grupo-cuerpo tr').length,
        vista: !document.getElementById('vista-grupo').hidden,
      })`);
      if (importe.filas === 3) break;
    } catch { /* navegando */ }
  }
  comprobar('Un enlace compartido (?amigos=) importa el grupo y abre la vista',
    importe.filas === 3 && importe.vista, `${importe.filas} integrantes tras importar 2`);

  /* Capturas de trabajo de la vista grupo (solo para revision, no van al manifest). */
  for (const [archivo, ancho, alto, movil] of [
    ['/tmp/ranking-lan-grupo-escritorio.png', 1280, 800, false],
    ['/tmp/ranking-lan-grupo-movil.png', 412, 915, true],
  ]) {
    await cdp.enviar('Emulation.setDeviceMetricsOverride', {
      width: ancho, height: alto, deviceScaleFactor: 1, mobile: movil,
    });
    await espera(400);
    const captura = await cdp.enviar('Page.captureScreenshot', { format: 'png' });
    writeFileSync(archivo, Buffer.from(captura.data, 'base64'));
  }
  await cdp.enviar('Emulation.clearDeviceMetricsOverride');

  /* --- Manifest -------------------------------------------------------- */
  console.log('\nPWA');
  const manifest = await cdp.evaluar(`(async () => {
    const r = await fetch('./manifest.webmanifest');
    const m = await r.json();
    return { ok: r.ok, nombre: m.name, display: m.display, iconos: m.icons.length,
             maskable: m.icons.some(i => i.purpose === 'maskable'),
             atajos: (m.shortcuts||[]).length, startUrl: m.start_url, scope: m.scope };
  })()`);
  comprobar('manifest.webmanifest es JSON válido', manifest.ok, manifest.nombre);
  comprobar('display: standalone', manifest.display === 'standalone');
  comprobar('Incluye icono maskable', manifest.maskable, `${manifest.iconos} iconos`);
  comprobar('Declara atajos (shortcuts)', manifest.atajos > 0, `${manifest.atajos}`);

  const sw = await cdp.evaluar(`(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    if (!r) return { registrado: false };
    await navigator.serviceWorker.ready;
    const nombres = await caches.keys();
    const shell = await caches.open(nombres.find(n => n.includes('shell')) || 'x');
    const claves = await shell.keys();
    return {
      registrado: true,
      alcance: r.scope,
      activo: !!r.active,
      caches: nombres,
      precacheados: claves.length,
      rutas: claves.map(k => new URL(k.url).pathname),
    };
  })()`);
  comprobar('El service worker se registra y activa', sw.registrado && sw.activo, sw.alcance);
  comprobar('Precachea el app shell', sw.precacheados >= 10, `${sw.precacheados} recursos`);
  for (const esperado of ['/index.html', '/offline.html', '/css/estilos.css', '/js/app.js', '/js/amigos.js', '/js/i18n.js', '/datos/ranking-lan.json']) {
    comprobar(`  precacheado ${esperado}`, sw.rutas.some((r) => r.endsWith(esperado)));
  }
  // Chrome solo dispara beforeinstallprompt si se cumplen TODOS los criterios de
  // instalabilidad: origen seguro, manifest con nombre, iconos 192 y 512, start_url,
  // display standalone y un service worker con manejador de fetch. Que el boton
  // este visible es, por tanto, la mejor senal de que la PWA es instalable.
  const instalable = await cdp.evaluar(`!document.getElementById('btn-instalar').hidden`);
  comprobar('Chrome la considera instalable (beforeinstallprompt)', instalable,
    instalable ? 'botón de instalación visible' : 'el evento no se disparó');

  comprobar('El texto de estado del SW se actualiza en la UI',
    !(await cdp.evaluar(`document.getElementById('estado-sw').textContent`)).includes('comprobando'),
    await cdp.evaluar(`document.getElementById('estado-sw').textContent`));

  /* --- Capturas para el manifest --------------------------------------- */
  console.log('\nCapturas');

  // Volvemos a la vista global: las capturas del manifest muestran el ladder.
  await cdp.enviar('Page.navigate', { url: URL_APP + '?vista=global' });
  for (let i = 0; i < 60; i++) {
    await espera(250);
    try {
      const listas = await cdp.evaluar(
        `document.querySelectorAll('#cuerpo-tabla tr:not(.esqueleto)').length`);
      if (listas > 0) break;
    } catch { /* navegando */ }
  }
  for (const [nombre, ancho, alto, movil] of [
    ['captura-movil', 412, 915, true],
    ['captura-escritorio', 1280, 800, false],
  ]) {
    await cdp.enviar('Emulation.setDeviceMetricsOverride', {
      width: ancho, height: alto, deviceScaleFactor: 1, mobile: movil,
    });
    await espera(600);
    const { data } = await cdp.enviar('Page.captureScreenshot', { format: 'png' });
    const destino = join(RAIZ, 'iconos', `${nombre}.png`);
    writeFileSync(destino, Buffer.from(data, 'base64'));
    comprobar(`Captura ${nombre}.png`, true, `${ancho}x${alto}`);
  }
  await cdp.enviar('Emulation.clearDeviceMetricsOverride');

  /* --- Modo offline ----------------------------------------------------- */
  console.log('\nOffline');
  await cdp.enviar('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await cdp.enviar('Page.reload', { ignoreCache: false });

  let filasOffline = 0;
  for (let intento = 0; intento < 60; intento++) {
    await espera(250);
    try {
      filasOffline = await cdp.evaluar(
        `document.querySelectorAll('#cuerpo-tabla tr:not(.esqueleto)').length`,
      );
      if (filasOffline > 0) break;
    } catch { /* recargando */ }
  }
  comprobar('La app abre sin red', filasOffline > 0, `${filasOffline} filas desde caché`);
  const chipOffline = await cdp.evaluar(`document.getElementById('chip-conexion').dataset.estado`);
  comprobar('Detecta que no hay conexión', chipOffline === 'sin-conexion', chipOffline);

  const grupoOffline = await cdp.evaluar(`(async () => {
    document.getElementById('tab-grupo').click();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (document.querySelectorAll('#grupo-cuerpo tr').length > 0) break;
    }
    return {
      filas: document.querySelectorAll('#grupo-cuerpo tr').length,
      liga: document.querySelector('#grupo-cuerpo .rango')?.textContent ?? '',
    };
  })()`);
  comprobar('El grupo también funciona offline (rangos desde caché)',
    grupoOffline.filas >= 1 && grupoOffline.liga.length > 0 && grupoOffline.liga !== 'Sin datos',
    `${grupoOffline.filas} integrante · ${grupoOffline.liga}`);

  await cdp.enviar('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });

  /* --- Consola limpia --------------------------------------------------- */
  console.log('\nConsola');
  const errores = cdp.eventos
    .filter((e) =>
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
      e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
    .map((e) =>
      e.params.entry?.text ??
      e.params.exceptionDetails?.exception?.description ??
      e.params.args?.map((a) => a.value ?? a.description).join(' '))
    // Al emular offline es normal que fetch falle: ese error lo provoca la prueba.
    .filter((texto) => texto && !/ERR_INTERNET_DISCONNECTED|Failed to load resource.*offline/i.test(texto));

  comprobar('Sin errores de consola ni excepciones', errores.length === 0,
    errores.length ? `\n      ${errores.join('\n      ')}` : '');

  /* --- Resumen ---------------------------------------------------------- */
  const fallos = resultados.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(58)}`);
  console.log(`  ${resultados.length - fallos.length}/${resultados.length} comprobaciones correctas`);
  if (fallos.length) {
    console.log('  Fallos:');
    for (const f of fallos) console.log(`    ✗ ${f.nombre} ${f.detalle}`);
    codigoSalida = 1;
  }
  console.log('─'.repeat(58));
} catch (error) {
  console.error('\nLa verificación no pudo completarse:', error.message);
  codigoSalida = 1;
} finally {
  cdp?.cerrar();
  chrome.kill('SIGKILL');
  await espera(300);
  rmSync(perfil, { recursive: true, force: true });
  process.exit(codigoSalida);
}

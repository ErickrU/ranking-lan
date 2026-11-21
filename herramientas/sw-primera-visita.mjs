/**
 * Primera visita: ¿se instala y activa el service worker en un perfil nuevo?
 *
 * Repite N veces: arranca Chrome headless con un perfil recien creado, navega a
 * la URL y observa por CDP la instalacion del service worker (dominio
 * ServiceWorker: estados de cada version, errores; dominio Target: sesion del
 * propio worker para ver sus peticiones y su consola; targets de extensiones
 * del navegador para correlacionar en el tiempo). Al final cuenta cuantos
 * intentos terminan con el SW activado y controlando la pagina.
 *
 * Sin dependencias: WebSocket nativo de Node (>= 22) y herramientas/cdp.mjs.
 *
 * Uso:
 *   node herramientas/sw-primera-visita.mjs --url https://d3b4s9lb316i67.cloudfront.net/ --intentos 10
 *
 * Opciones:
 *   --url <u>               URL de la app (por defecto producción)
 *   --intentos <n>          repeticiones (10)
 *   --cdp <puerto>          primer puerto CDP; cada intento usa el siguiente (9500)
 *   --tiempo <ms>           espera maxima por intento hasta activated/redundant (20000)
 *   --margen <ms>           espera tras el desenlace para recoger los ultimos eventos (2500)
 *   --gracia <ms>           tras un 'redundant', espera a un reintento de la pagina antes de fallar (2500)
 *   --espera-nav <ms>       espera entre arrancar Chrome y navegar (0)
 *   --sin-extensiones       arranca Chrome con --disable-extensions
 *   --sin-sesion-sw         no se adjunta al target del worker (solo se observa desde la pagina)
 *   --latencia-sw <ms>      emula esa latencia en las peticiones del SW (Network.emulateNetworkConditions
 *                           en la sesion del worker) para alargar su instalacion; solo para diagnostico
 *   --detalle               imprime la cronologia de cada intento
 *   --salida <dir>          guarda por intento la cronologia (JSON) y el stderr de Chrome
 *
 * Codigo de salida: 0 si todos los intentos activan el SW, 1 si alguno falla.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, openSync, closeSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME, espera, paginaInicial } from './cdp.mjs';

const flag = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : def;
};
const URL_APP = flag('url', 'https://d3b4s9lb316i67.cloudfront.net/');
const INTENTOS = Number(flag('intentos', 10));
const PUERTO_BASE = Number(flag('cdp', 9500));
const TIEMPO_MAX = Number(flag('tiempo', 20_000));
const MARGEN_FINAL = Number(flag('margen', 2_500));
/** Tras un 'redundant', ms de espera a que la pagina reintente antes de dar el intento por fallido. */
const GRACIA = Number(flag('gracia', 2_500));
const ESPERA_NAV = Number(flag('espera-nav', 0));
const SIN_EXTENSIONES = process.argv.includes('--sin-extensiones');
const SIN_SESION_SW = process.argv.includes('--sin-sesion-sw');
/** Latencia (ms) emulada por CDP en las peticiones del SW; exige adjuntarse antes de que arranque. */
const LATENCIA_SW = Number(flag('latencia-sw', 0));
const DETALLE = process.argv.includes('--detalle');
const SALIDA = flag('salida', null);
const ORIGEN = new URL(URL_APP).origin;

if (SALIDA) mkdirSync(SALIDA, { recursive: true });

/* ================================================================
   Cliente CDP con sesiones planas (flatten) y marca de tiempo por evento
   ================================================================ */
class Sesiones {
  #ws; #id = 0; #pendientes = new Map();
  oyentes = [];

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (e) => {
      const mensaje = JSON.parse(e.data);
      if (mensaje.id !== undefined) {
        const pendiente = this.#pendientes.get(mensaje.id);
        this.#pendientes.delete(mensaje.id);
        mensaje.error ? pendiente?.rechazar(new Error(mensaje.error.message)) : pendiente?.resolver(mensaje.result);
      } else {
        mensaje.t = Date.now();
        for (const oyente of this.oyentes) oyente(mensaje);
      }
    });
  }

  static async conectar(url) {
    const ws = new WebSocket(url);
    await new Promise((resolver, rechazar) => {
      ws.addEventListener('open', resolver, { once: true });
      ws.addEventListener('error', () => rechazar(new Error('No se pudo abrir el WebSocket de CDP')), { once: true });
    });
    return new Sesiones(ws);
  }

  enviar(method, params = {}, sessionId) {
    const id = ++this.#id;
    return new Promise((resolver, rechazar) => {
      this.#pendientes.set(id, { resolver, rechazar });
      this.#ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      setTimeout(() => {
        if (this.#pendientes.delete(id)) rechazar(new Error(`Tiempo agotado en ${method}`));
      }, 15_000);
    });
  }

  async evaluar(expresion, sessionId) {
    const { result, exceptionDetails } = await this.enviar('Runtime.evaluate', {
      expression: expresion, awaitPromise: true, returnByValue: true,
    }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'Error al evaluar');
    return result.value;
  }

  cerrar() { this.#ws.close(); }
}

/* ================================================================
   Un intento
   ================================================================ */
async function intento(numero) {
  const puerto = PUERTO_BASE + numero - 1;
  const perfil = mkdtempSync(join(tmpdir(), 'ranking-lan-primera-visita-'));
  const argumentos = [
    '--headless=new',
    `--remote-debugging-port=${puerto}`,
    `--user-data-dir=${perfil}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
  ];
  if (SIN_EXTENSIONES) argumentos.push('--disable-extensions');
  let fdLog = null;
  if (SALIDA) {
    argumentos.push('--enable-logging=stderr');
    fdLog = openSync(join(SALIDA, `intento-${String(numero).padStart(2, '0')}-chrome.log`), 'w');
  }
  argumentos.push('about:blank');

  const t0 = Date.now();
  const chrome = spawn(CHROME, argumentos, { stdio: ['ignore', 'ignore', fdLog ?? 'ignore'] });

  const cronologia = [];
  let tNav = null; // instante absoluto de la navegacion; los tiempos se expresan respecto a el
  const anotar = (t, texto) => cronologia.push({ t, texto });
  const relativo = (t) => t - (tNav ?? t0);

  const resultado = {
    intento: numero,
    activado: false,
    controla: false,
    reintentos: 0,        // nuevas instalaciones tras la primera (reintentos de la pagina)
    estados: [],          // transiciones de estado de las versiones del SW de la app
    error: null,          // ServiceWorker.workerErrorReported
    registroBorrado: false,
    peticionesSw: { total: 0, fallidas: [] }, // red vista desde la sesion del SW
    consolaSw: [],
    extensiones: [],      // targets chrome-extension:// creados (t relativo a la navegacion)
    crash: null,
    cronologia,
  };

  let navegador = null;
  let pagina = null;
  try {
    const objetivo = await paginaInicial(puerto);
    const version = await (await fetch(`http://127.0.0.1:${puerto}/json/version`)).json();
    navegador = await Sesiones.conectar(version.webSocketDebuggerUrl);
    pagina = await Sesiones.conectar(objetivo.webSocketDebuggerUrl);

    const sesionesSw = new Set();
    const peticionesSw = new Map();

    /* --- Sesion del navegador: todos los targets y los service workers ---- */
    navegador.oyentes.push((m) => {
      if (m.method === 'Target.targetCreated' || m.method === 'Target.targetInfoChanged') {
        const { url, type, targetId } = m.params.targetInfo;
        if (url.startsWith('chrome-extension://') && !resultado.extensiones.some((e) => e.targetId === targetId)) {
          resultado.extensiones.push({ targetId, type, url, t: m.t });
          anotar(m.t, `extension: target ${type} ${new URL(url).host}`);
        }
      } else if (m.method === 'Target.targetCrashed') {
        resultado.crash = m.params;
        anotar(m.t, `TARGET CRASHED ${m.params.targetId} (${m.params.status}, ${m.params.errorCode})`);
      } else if (m.method === 'Target.attachedToTarget') {
        const { sessionId, targetInfo, waitingForDebugger } = m.params;
        if (targetInfo.type === 'service_worker' && targetInfo.url.startsWith(ORIGEN)) {
          sesionesSw.add(sessionId);
          anotar(m.t, `sesion del SW adjunta (${targetInfo.url})`);
          (async () => {
            try {
              await navegador.enviar('Runtime.enable', {}, sessionId);
              await navegador.enviar('Log.enable', {}, sessionId);
              await navegador.enviar('Network.enable', {}, sessionId);
              if (LATENCIA_SW > 0) {
                await navegador.enviar('Network.emulateNetworkConditions', {
                  offline: false, latency: LATENCIA_SW, downloadThroughput: -1, uploadThroughput: -1,
                }, sessionId);
              }
            } catch { /* el worker puede haber muerto ya */ }
            if (waitingForDebugger) navegador.enviar('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
          })();
        } else if (waitingForDebugger) {
          navegador.enviar('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
        }
      } else if (m.method === 'Target.detachedFromTarget' && sesionesSw.has(m.params.sessionId)) {
        anotar(m.t, 'sesion del SW desprendida (el worker se detuvo)');
      } else if (m.sessionId && sesionesSw.has(m.sessionId)) {
        // Eventos del propio service worker de la app.
        if (m.method === 'Network.requestWillBeSent') {
          resultado.peticionesSw.total++;
          peticionesSw.set(m.params.requestId, { url: m.params.request.url, t: m.t });
        } else if (m.method === 'Network.loadingFailed') {
          const p = peticionesSw.get(m.params.requestId);
          const fallo = { url: p?.url ?? m.params.requestId, errorText: m.params.errorText, canceled: m.params.canceled === true, t: m.t };
          resultado.peticionesSw.fallidas.push(fallo);
          anotar(m.t, `SW red FALLA ${fallo.errorText}${fallo.canceled ? ' (cancelada)' : ''} ${new URL(fallo.url).pathname}`);
        } else if (m.method === 'Network.responseReceived') {
          const { status, url } = m.params.response;
          if (status >= 300) anotar(m.t, `SW red ${status} ${new URL(url).pathname}`);
        } else if (m.method === 'Runtime.consoleAPICalled') {
          const texto = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
          resultado.consolaSw.push(`${m.params.type}: ${texto}`);
          anotar(m.t, `SW consola ${m.params.type}: ${texto}`);
        } else if (m.method === 'Runtime.exceptionThrown') {
          const texto = m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text;
          resultado.consolaSw.push(`excepcion: ${texto}`);
          anotar(m.t, `SW EXCEPCION ${texto}`);
        } else if (m.method === 'Log.entryAdded') {
          anotar(m.t, `SW log ${m.params.entry.level}: ${m.params.entry.text}`);
        } else if (m.method === 'Inspector.targetCrashed') {
          resultado.crash = { sw: true };
          anotar(m.t, 'SW TARGET CRASHED');
        }
      }
    });
    await navegador.enviar('Target.setDiscoverTargets', { discover: true });
    // Sin waitForDebuggerOnStart no se altera el ritmo de arranque del worker;
    // con latencia emulada hay que detenerlo al arrancar para configurarla antes.
    if (!SIN_SESION_SW) {
      await navegador.enviar('Target.setAutoAttach', {
        autoAttach: true, waitForDebuggerOnStart: LATENCIA_SW > 0, flatten: true, filter: [{ type: 'service_worker', exclude: false }],
      });
    }

    /* --- Sesion de la pagina: registro del SW, red y consola -------------- */
    // El desenlace se decide por tiempos, no al primer evento, para contemplar
    // el reintento que js/registro-sw.js hace tras un 'redundant':
    //  - exito en cuanto una version del origen llega a 'activated';
    //  - fallo solo si, tras un 'redundant', pasan GRACIA ms sin que empiece a
    //    instalarse una version nueva (nadie reintenta) y sin controlador.
    const ultimoEstado = new Map(); // versionId -> `${status}/${runningStatus}`
    let tActivado = null;      // instante del primer activated del origen
    let tRedundante = null;    // instante del ultimo redundant / registro borrado
    let tInstalando = null;    // instante del ultimo installing (incluye reintentos)
    pagina.oyentes.push((m) => {
      if (m.method === 'ServiceWorker.workerVersionUpdated') {
        for (const v of m.params.versions) {
          // Solo el SW de la app: Chrome tambien registra los de sus extensiones.
          if (!v.scriptURL?.startsWith(ORIGEN)) continue;
          const clave = `${v.status}/${v.runningStatus}`;
          if (ultimoEstado.get(v.versionId) === clave) continue;
          ultimoEstado.set(v.versionId, clave);
          resultado.estados.push({ versionId: v.versionId, status: v.status, runningStatus: v.runningStatus, t: m.t });
          anotar(m.t, `SW version ${v.versionId}: ${v.status} · worker ${v.runningStatus}`);
          if (v.status === 'installing') tInstalando = m.t;
          if (v.status === 'activated') { resultado.activado = true; tActivado ??= m.t; }
          if (v.status === 'redundant') tRedundante = m.t;
        }
      } else if (m.method === 'ServiceWorker.workerRegistrationUpdated') {
        for (const r of m.params.registrations) {
          if (!r.scopeURL?.startsWith(ORIGEN)) continue;
          anotar(m.t, `SW registro ${r.registrationId} ${r.scopeURL}${r.isDeleted ? ' BORRADO' : ''}`);
          if (r.isDeleted) { resultado.registroBorrado = true; tRedundante = m.t; }
        }
      } else if (m.method === 'ServiceWorker.workerErrorReported') {
        const e = m.params.errorMessage;
        resultado.error = e.errorMessage;
        anotar(m.t, `SW ERROR: ${e.errorMessage} (${e.sourceURL}:${e.lineNumber})`);
      } else if (m.method === 'Page.loadEventFired') {
        anotar(m.t, 'pagina: load');
      } else if (m.method === 'Network.requestWillBeSent' && /\/sw\.js(\?|$)/.test(m.params.request.url)) {
        anotar(m.t, `pagina: peticion ${new URL(m.params.request.url).pathname} (${m.params.type})`);
      } else if (m.method === 'Network.loadingFailed') {
        anotar(m.t, `pagina red FALLA ${m.params.errorText}${m.params.canceled ? ' (cancelada)' : ''} ${m.params.requestId}`);
      } else if (m.method === 'Runtime.exceptionThrown') {
        anotar(m.t, `pagina EXCEPCION ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
      } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        anotar(m.t, `pagina log error: ${m.params.entry.text}`);
      } else if (m.method === 'Inspector.targetCrashed') {
        resultado.crash = { pagina: true };
        anotar(m.t, 'PAGINA CRASHED');
      }
    });
    await pagina.enviar('Page.enable');
    await pagina.enviar('Runtime.enable');
    await pagina.enviar('Log.enable');
    await pagina.enviar('Network.enable');
    await pagina.enviar('ServiceWorker.enable');

    if (ESPERA_NAV > 0) await espera(ESPERA_NAV);
    tNav = Date.now();
    anotar(tNav, `navegar a ${URL_APP} (Chrome arrancado hace ${tNav - t0} ms)`);
    await pagina.enviar('Page.navigate', { url: URL_APP });

    const limite = Date.now() + TIEMPO_MAX;
    let desenlace = null;
    while (!desenlace && Date.now() < limite) {
      await espera(100);
      const ahora = Date.now();
      if (tActivado) desenlace = 'activated';
      else if (tRedundante && ahora - tRedundante > GRACIA && (!tInstalando || ahora - tInstalando > GRACIA)) desenlace = 'sin reintento';
    }
    if (!desenlace) anotar(Date.now(), `tiempo agotado (${TIEMPO_MAX} ms) sin activar`);
    else if (desenlace === 'sin reintento') anotar(Date.now(), `la pagina no reintenta tras 'redundant' (esperado ${GRACIA} ms)`);
    // Margen para recibir los ultimos eventos (claim, consola del SW) y ver que
    // extensiones termina de instalar Chrome justo despues.
    await espera(MARGEN_FINAL);

    try {
      const estado = await pagina.evaluar(`(async () => {
        const r = await navigator.serviceWorker.getRegistration();
        return {
          controla: !!navigator.serviceWorker.controller,
          registro: r ? { installing: !!r.installing, waiting: !!r.waiting, active: !!r.active, activeState: r.active?.state ?? null } : null,
          estadoSw: document.getElementById('estado-sw')?.textContent ?? null,
        };
      })()`);
      resultado.controla = estado.controla;
      resultado.pagina = estado;
      anotar(Date.now(), `pagina: controller=${estado.controla} registro=${JSON.stringify(estado.registro)} · «${estado.estadoSw}»`);
    } catch (error) {
      anotar(Date.now(), `no se pudo consultar la pagina: ${error.message}`);
    }
  } catch (error) {
    resultado.fallo = error.message;
    anotar(Date.now(), `ERROR del intento: ${error.message}`);
  } finally {
    pagina?.cerrar();
    navegador?.cerrar();
    chrome.kill('SIGKILL');
    await espera(400);
    if (fdLog !== null) closeSync(fdLog);
    rmSync(perfil, { recursive: true, force: true });
  }

  // Reintentos = versiones del origen que entraron en 'installing', menos la primera.
  resultado.reintentos = Math.max(0, new Set(resultado.estados.filter((e) => e.status === 'installing').map((e) => e.versionId)).size - 1);
  // Tiempos en ms relativos a la navegacion (negativos: antes de navegar).
  for (const e of cronologia) e.t = relativo(e.t);
  for (const e of resultado.extensiones) e.t = relativo(e.t);
  for (const e of resultado.estados) e.t = relativo(e.t);
  for (const e of resultado.peticionesSw.fallidas) e.t = relativo(e.t);
  cronologia.sort((a, b) => a.t - b.t);
  if (SALIDA) {
    writeFileSync(join(SALIDA, `intento-${String(numero).padStart(2, '0')}.json`), JSON.stringify(resultado, null, 2));
  }
  return resultado;
}

/* ================================================================
   Principal
   ================================================================ */
console.log(`URL: ${URL_APP} · intentos: ${INTENTOS} · Chrome: ${CHROME}${SIN_EXTENSIONES ? ' · --disable-extensions' : ''}${ESPERA_NAV ? ` · espera antes de navegar ${ESPERA_NAV} ms` : ''}${LATENCIA_SW ? ` · latencia emulada en el SW ${LATENCIA_SW} ms` : ''}\n`);

const resultados = [];
for (let n = 1; n <= INTENTOS; n++) {
  const r = await intento(n);
  resultados.push(r);
  const ok = r.activado && r.controla;
  const tInstalando = r.estados.find((e) => e.status === 'installing')?.t;
  const tActivado = r.estados.find((e) => e.status === 'activated')?.t;
  const tRedundante = r.estados.find((e) => e.status === 'redundant')?.t;
  const extDurante = r.extensiones.filter((e) => tInstalando != null && e.t >= tInstalando && (tActivado == null || e.t <= tActivado + 50)).length;
  const reintento = r.reintentos > 0 ? ` tras ${r.reintentos} reintento/s` : '';
  const resumen = ok
    ? `OK   activado a +${tActivado} ms${reintento} (installing a +${tInstalando} ms)`
    : `FALLA ${r.error ?? r.fallo ?? (r.registroBorrado ? 'registro borrado' : 'sin activar')}${tRedundante != null ? ` · redundant a +${tRedundante} ms` : ''}${r.peticionesSw.fallidas.length ? ` · ${r.peticionesSw.fallidas.length} peticiones del SW canceladas` : ''}`;
  console.log(`[${String(n).padStart(2, ' ')}/${INTENTOS}] ${resumen} · extensiones cargadas durante la instalacion (±50 ms): ${extDurante} de ${r.extensiones.length} vistas`);
  if (DETALLE) {
    for (const e of r.cronologia) console.log(`         ${String(e.t).padStart(6, ' ')} ms  ${e.texto}`);
    console.log('');
  }
}

const correctos = resultados.filter((r) => r.activado && r.controla).length;
const fallidos = resultados.filter((r) => !(r.activado && r.controla));
console.log(`\nResultado: ${correctos}/${INTENTOS} intentos instalan y activan el service worker en la primera carga (${fallidos.length} fallan).`);
if (fallidos.length > 0) {
  const errores = new Map();
  for (const f of fallidos) {
    const clave = f.error ?? f.fallo ?? 'sin error reportado';
    errores.set(clave, (errores.get(clave) ?? 0) + 1);
  }
  for (const [error, veces] of errores) console.log(`  · ${veces}× ${error}`);
  const canceladas = fallidos.flatMap((f) => f.peticionesSw.fallidas.map((p) => new URL(p.url).pathname));
  if (canceladas.length > 0) console.log(`  · peticiones del SW canceladas al morir: ${[...new Set(canceladas)].join(', ')}`);
}
if (SALIDA) writeFileSync(join(SALIDA, 'resumen.json'), JSON.stringify({ url: URL_APP, intentos: INTENTOS, correctos, sinExtensiones: SIN_EXTENSIONES, esperaNav: ESPERA_NAV, latenciaSw: LATENCIA_SW, resultados }, null, 2));
process.exit(correctos === INTENTOS ? 0 : 1);

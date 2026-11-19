/**
 * Seccion "Avisos y distintivos": Notifications API + App Badging segun la
 * guia de Microsoft Edge para PWA, sin servidor push.
 *
 * La logica de diferencias vive en el service worker (bloque AVISOS de sw.js);
 * este modulo solo:
 *   - publica por postMessage los datos frescos que ya tiene la pagina
 *     (AVISOS_DATOS con config, ranking y/o grupo),
 *   - manda ordenes (AVISOS_PROBAR, AVISOS_VISTOS, AVISOS_SINCRONIZAR),
 *   - pinta lo que el SW difunde (AVISOS_PENDIENTES, AVISOS_PROBADO, AVISOS_IR).
 *
 * El permiso de notificaciones se pide SOLO al pulsar «Activar avisos». La
 * preferencia vive en localStorage ('ranking-lan:avisos') y viaja ademas en
 * `config` para que el SW la conozca en segundo plano. Sin innerHTML.
 */

import { t, localeActual } from './i18n.js';

const CLAVE_AVISOS = 'ranking-lan:avisos';
const TAG_SYNC = 'avisos';
const INTERVALO_SYNC_MS = 12 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */
const $ = (selector) => document.querySelector(selector);

const nodos = {
  seccion: $('#avisos'),
  contador: $('#avisos-contador'),
  activar: $('#avisos-activar'),
  interruptorEtiqueta: $('#avisos-interruptor-etiqueta'),
  interruptor: $('#avisos-interruptor'),
  probar: $('#avisos-probar'),
  comprobar: $('#avisos-comprobar'),
  estado: $('#avisos-estado'),
  lista: $('#avisos-lista'),
  vacio: $('#avisos-vacio'),
};

/* ------------------------------------------------------------------ *
 * Estado
 * ------------------------------------------------------------------ */
const estado = {
  activados: false,
  ultimaSeleccion: null, // { region, cola, tier, division } del ultimo listado
  ultimoGrupo: null,     // { cola, region, miembros:[{riotId, tier, division, lp}] }
  ultimosCambios: [],    // lo ultimo difundido por el SW, para repintar al traducir
  ultimoBadge: null,
  ultimoTexto: null,     // { clave, sync } del texto de estado, para retraducir
};

let anunciar = () => {};

function leer() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_AVISOS) ?? '{}');
    estado.activados = guardado.activados === true;
  } catch { /* localStorage bloqueado o JSON corrupto: desactivados */ }
}

function guardar() {
  try {
    localStorage.setItem(CLAVE_AVISOS, JSON.stringify({ activados: estado.activados }));
  } catch { /* modo privado: la preferencia vive solo esta sesion */ }
}

/* ------------------------------------------------------------------ *
 * Mensajes hacia el service worker
 * ------------------------------------------------------------------ */

/** Envia al SW activo; sin soporte o sin registro, silencio. */
function enviar(mensaje) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((registro) => registro.active?.postMessage(mensaje))
    .catch(() => {});
}

function componerConfig() {
  const seleccion = estado.ultimaSeleccion ?? {};
  const grupo = estado.ultimoGrupo;
  return {
    activados: estado.activados,
    region: seleccion.region ?? grupo?.region ?? null,
    cola: seleccion.cola ?? null,
    tier: seleccion.tier ?? null,
    division: seleccion.division ?? null,
    grupo: {
      miembros: grupo ? grupo.miembros.map((m) => m.riotId) : [],
      cola: grupo?.cola ?? null,
    },
  };
}

const enviarConfig = () => enviar({ tipo: 'AVISOS_DATOS', config: componerConfig() });

/**
 * app.js termina cargar() con exito. Se ignoran las copias de cache (no son
 * datos nuevos) y los top 3 con nombres pendientes (clave null).
 */
export function publicarRanking(listado) {
  if (!listado || typeof listado !== 'object') return;
  const { region, cola, tier, division } = listado;
  estado.ultimaSeleccion = { region, cola, tier, division };
  if (listado.fuente === 'cache') return;

  const top3 = [...(listado.jugadores ?? [])]
    .sort((a, b) => a.puesto - b.puesto)
    .slice(0, 3)
    .map((j) => ({ clave: j.puuid ?? j.riotId ?? null, riotId: j.riotId ?? null, lp: j.lp }));
  if (top3.length === 0 || top3.some((j) => j.clave == null || j.riotId == null)) return;

  enviar({
    tipo: 'AVISOS_DATOS',
    config: componerConfig(),
    ranking: { clave: `${region}|${cola}|${tier}|${division}`, region, cola, tier, division, top3 },
  });
}

/**
 * amigos.js termina cargarTodos()/agregar()/quitar(). `miembros` llega ya
 * filtrado: solo integrantes clasificados y con datos frescos.
 */
export function publicarGrupo({ cola, region, miembros }) {
  if (!Array.isArray(miembros)) return;
  estado.ultimoGrupo = { cola, region, miembros };
  enviar({ tipo: 'AVISOS_DATOS', config: componerConfig(), grupo: { cola, region, miembros } });
}

/* ------------------------------------------------------------------ *
 * Interfaz
 * ------------------------------------------------------------------ */

/** Texto de estado; recuerda la clave para re-traducirlo si cambia el idioma. */
function informar(clave, sync = null) {
  estado.ultimoTexto = { clave, sync };
  if (!nodos.estado) return;
  nodos.estado.textContent = sync ? `${t(clave)} · ${t(`avisos.sync.${sync}`)}` : t(clave);
}

function habilitarControles(activos) {
  if (nodos.probar) nodos.probar.disabled = !activos;
  if (nodos.comprobar) nodos.comprobar.disabled = !activos;
}

function mostrarBotonActivar() {
  if (nodos.activar) nodos.activar.hidden = false;
  if (nodos.interruptorEtiqueta) nodos.interruptorEtiqueta.hidden = true;
  habilitarControles(false);
}

/**
 * Periodic Background Sync solo existe con la app instalada (Chromium); en el
 * navegador el permiso llega 'denied' y se explica con texto, sin excepciones.
 */
async function registrarSync() {
  let sync = 'noDisponible';
  try {
    const registro = await navigator.serviceWorker.ready;
    if ('periodicSync' in registro) {
      const permiso = await navigator.permissions
        .query({ name: 'periodic-background-sync' })
        .catch(() => ({ state: 'denied' }));
      if (permiso.state === 'granted') {
        await registro.periodicSync.register(TAG_SYNC, { minInterval: INTERVALO_SYNC_MS });
        sync = 'registrada';
      }
    }
  } catch { /* sin service worker o registro rechazado */ }
  informar('avisos.estado.activados', sync);
}

function activar() {
  estado.activados = true;
  guardar();
  if (nodos.activar) nodos.activar.hidden = true;
  if (nodos.interruptorEtiqueta) nodos.interruptorEtiqueta.hidden = false;
  if (nodos.interruptor) nodos.interruptor.checked = true;
  habilitarControles(true);
  enviarConfig();
  registrarSync();
}

async function desactivar() {
  estado.activados = false;
  guardar();
  if (nodos.interruptor) nodos.interruptor.checked = false;
  habilitarControles(false);
  enviarConfig();
  informar('avisos.estado.desactivados');
  try {
    const registro = await navigator.serviceWorker.ready;
    await registro.periodicSync?.unregister(TAG_SYNC);
  } catch { /* sin soporte */ }
  try { await navigator.clearAppBadge?.(); } catch { /* sin soporte */ }
}

/** Unico lugar donde se pide el permiso: siempre dentro de un clic del usuario. */
async function solicitarActivacion() {
  if (!('Notification' in window)) {
    informar('avisos.estado.sinSoporte');
    if (nodos.interruptor) nodos.interruptor.checked = false;
    return;
  }
  let permiso = Notification.permission;
  if (permiso !== 'granted') {
    try { permiso = await Notification.requestPermission(); } catch { permiso = 'denied'; }
  }
  if (permiso === 'granted') {
    activar();
    return;
  }
  if (nodos.interruptor) nodos.interruptor.checked = false;
  informar(permiso === 'denied' ? 'avisos.estado.denegado' : 'avisos.estado.desactivados');
}

function alternar() {
  if (!nodos.interruptor) return;
  if (!nodos.interruptor.checked) {
    desactivar();
    return;
  }
  if ('Notification' in window && Notification.permission === 'granted') activar();
  else solicitarActivacion();
}

/** La ventana vuelve a estar a la vista: pendientes a 0 y distintivo limpio. */
function marcarVistos() {
  enviar({ tipo: 'AVISOS_VISTOS' });
  try { navigator.clearAppBadge?.().catch(() => {}); } catch { /* sin soporte */ }
}

/* ------------------------------------------------------------------ *
 * Pintado de pendientes
 * ------------------------------------------------------------------ */

function formatearMomento(momento) {
  const fecha = new Date(momento);
  if (Number.isNaN(fecha.getTime())) return null;
  return {
    iso: fecha.toISOString(),
    texto: fecha.toLocaleString(localeActual(), { dateStyle: 'short', timeStyle: 'short' }),
  };
}

function pintarLista(cambios) {
  if (!nodos.lista) return;
  const items = cambios.map((cambio) => {
    const item = document.createElement('li');
    item.className = 'avisos__item';
    item.dataset.tipo = cambio.tipo === 'ranking' ? 'ranking' : 'grupo';

    const texto = document.createElement('span');
    texto.className = 'avisos__texto';
    texto.textContent = String(cambio.texto ?? '');
    item.append(texto);

    const momento = formatearMomento(cambio.momento);
    if (momento) {
      const hora = document.createElement('time');
      hora.dateTime = momento.iso;
      hora.textContent = momento.texto;
      item.append(hora);
    }
    return item;
  });
  nodos.lista.replaceChildren(...items);
  if (nodos.vacio) nodos.vacio.hidden = cambios.length > 0;
}

function pintarPendientes({ n, cambios, badge }) {
  const lista = Array.isArray(cambios) ? cambios.filter((c) => c && typeof c === 'object') : [];
  estado.ultimosCambios = lista;
  if (badge !== undefined) estado.ultimoBadge = badge;
  pintarLista(lista);

  const pendientes = Number.isInteger(n) && n > 0 ? n : 0;
  if (nodos.contador) {
    nodos.contador.textContent = String(pendientes);
    nodos.contador.hidden = pendientes === 0;
  }
}

/* ------------------------------------------------------------------ *
 * Mensajes del service worker
 * ------------------------------------------------------------------ */
function recibir(evento) {
  const mensaje = evento.data;
  if (!mensaje || typeof mensaje !== 'object') return;
  switch (mensaje.tipo) {
    case 'AVISOS_PENDIENTES':
      pintarPendientes(mensaje);
      break;
    case 'AVISOS_PROBADO':
      anunciar(t(mensaje.mostrado ? 'avisos.probado' : 'avisos.noMostrado'));
      break;
    case 'AVISOS_IR':
      dispatchEvent(new CustomEvent('irvista', { detail: { vista: mensaje.vista === 'grupo' ? 'grupo' : 'global' } }));
      marcarVistos();
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */

/** Repinta los textos que no pasan por data-i18n (estado y horas de la lista). */
export function retraducirAvisos() {
  if (estado.ultimoTexto) informar(estado.ultimoTexto.clave, estado.ultimoTexto.sync);
  pintarLista(estado.ultimosCambios);
}

/**
 * Inicializa la seccion. `anunciar(texto)` escribe en la region viva de la
 * pagina (la misma que usan los controles de la barra de titulo).
 */
export function iniciarAvisos({ anunciar: anunciarExterno } = {}) {
  if (!nodos.seccion) return;
  if (typeof anunciarExterno === 'function') anunciar = anunciarExterno;
  leer();

  nodos.activar?.addEventListener('click', () => solicitarActivacion());
  nodos.interruptor?.addEventListener('change', alternar);
  nodos.probar?.addEventListener('click', () => enviar({ tipo: 'AVISOS_PROBAR' }));
  nodos.comprobar?.addEventListener('click', () => enviar({ tipo: 'AVISOS_SINCRONIZAR' }));

  // Ver la seccion, volver a la ventana o a la pestana cuenta como "visto".
  nodos.seccion.addEventListener('toggle', () => { if (nodos.seccion.open) marcarVistos(); });
  addEventListener('focus', marcarVistos);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') marcarVistos();
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', recibir);

  const concedido = 'Notification' in window && Notification.permission === 'granted';
  if (concedido && estado.activados) {
    activar(); // re-registra periodicSync (idempotente) y publica la config
    return;
  }
  // Sin permiso vigente la preferencia guardada no vale: se vuelve a pedir al pulsar.
  if (estado.activados) {
    estado.activados = false;
    guardar();
  }
  mostrarBotonActivar();
}

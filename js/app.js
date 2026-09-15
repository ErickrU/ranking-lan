/**
 * Ranking LAN · orquestacion de la aplicacion.
 *
 * Mantiene un unico objeto de estado y vuelve a pintar a partir de el.
 * Cambiar region, cola, liga o division pide datos; cambiar orden, busqueda
 * o idioma solo repinta.
 */

import { obtenerRanking, COLAS, REGIONES, ORDEN_TIERS, TIERS_APEX } from './api.js';
import { t, iniciarI18n, aplicarEstaticos } from './i18n.js';
import {
  renderTabla,
  renderEsqueleto,
  renderPodio,
  renderResumen,
  renderEstado,
  renderTitulo,
  renderConteo,
  abrirDetalle,
} from './ui.js';
import { iniciarGrupo } from './amigos.js';

/* ------------------------------------------------------------------ *
 * Referencias al DOM
 * ------------------------------------------------------------------ */
const $ = (selector) => document.querySelector(selector);

const nodos = {
  selIdioma: $('#sel-idioma'),
  selRegion: $('#sel-region'),
  selCola: $('#sel-cola'),
  selTier: $('#sel-tier'),
  selDivision: $('#sel-division'),
  controlDivision: $('#control-division'),
  selOrden: $('#sel-orden'),
  buscar: $('#campo-buscar'),

  subCabecera: $('#sub-cabecera'),
  cuerpoTabla: $('#cuerpo-tabla'),
  podio: $('#podio'),
  tituloTabla: $('#titulo-tabla'),
  conteo: $('#conteo-visible'),
  notaNombres: $('#nota-nombres'),
  vacio: $('#mensaje-vacio'),
  cargando: $('#cargando'),

  metricas: {
    total: $('#m-total'),
    lpMax: $('#m-lp-max'),
    lpMin: $('#m-lp-min'),
    winrate: $('#m-winrate'),
  },

  estado: {
    chipConexion: $('#chip-conexion'),
    chipFuente: $('#chip-fuente'),
    tiempo: $('#texto-actualizado'),
    aviso: $('#aviso-demo'),
    avisoTexto: $('#aviso-demo-texto'),
  },

  botonActualizar: $('#btn-actualizar'),

  dialogo: $('#dialogo'),
  dialogoNodos: {
    titulo: $('#dialogo-titulo'),
    sub: $('#dialogo-sub'),
    datos: $('#dialogo-datos'),
    insignias: $('#dialogo-insignias'),
    extra: $('#dialogo-extra'),
  },
};

/* ------------------------------------------------------------------ *
 * Estado
 * ------------------------------------------------------------------ */
const CLAVE_PREFERENCIAS = 'ranking-lan:preferencias';

const listadoVacio = {
  fuente: 'demo',
  aviso: null,
  region: 'la1',
  cola: 'RANKED_SOLO_5x5',
  tier: 'CHALLENGER',
  division: 'I',
  actualizado: null,
  nombresPendientes: 0,
  jugadores: [],
  total: 0,
};

const estado = {
  region: 'la1',
  cola: 'RANKED_SOLO_5x5',
  tier: 'CHALLENGER',
  division: 'I',
  orden: 'lp-desc',
  busqueda: '',
  listado: listadoVacio,
  cargando: false,
};

const DIVISIONES = ['I', 'II', 'III', 'IV'];

function leerPreferencias() {
  // 1. Lo guardado de la visita anterior.
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_PREFERENCIAS) ?? '{}');
    if (REGIONES.includes(guardado.region)) estado.region = guardado.region;
    if (guardado.cola in COLAS) estado.cola = guardado.cola;
    if (ORDEN_TIERS.includes(guardado.tier)) estado.tier = guardado.tier;
    if (DIVISIONES.includes(guardado.division)) estado.division = guardado.division;
    if (guardado.orden in COMPARADORES) estado.orden = guardado.orden;
  } catch { /* localStorage bloqueado o JSON corrupto: usamos los valores por defecto */ }

  // 2. Los parametros de la URL tienen prioridad: asi funcionan los atajos
  //    declarados en manifest.webmanifest (shortcuts).
  const parametros = new URLSearchParams(location.search);
  const region = parametros.get('region')?.toLowerCase();
  const cola = parametros.get('cola');
  const tier = parametros.get('tier')?.toUpperCase();
  const division = parametros.get('division')?.toUpperCase();
  if (region && REGIONES.includes(region)) estado.region = region;
  if (cola && cola in COLAS) estado.cola = cola;
  if (tier && ORDEN_TIERS.includes(tier)) estado.tier = tier;
  if (division && DIVISIONES.includes(division)) estado.division = division;
}

function guardarPreferencias() {
  try {
    localStorage.setItem(
      CLAVE_PREFERENCIAS,
      JSON.stringify({
        region: estado.region,
        cola: estado.cola,
        tier: estado.tier,
        division: estado.division,
        orden: estado.orden,
      }),
    );
  } catch { /* modo privado: no pasa nada */ }
}

/* ------------------------------------------------------------------ *
 * Filtrado y orden
 * ------------------------------------------------------------------ */

/** Quita acentos y baja a minusculas para que la busqueda sea tolerante. */
const plegar = (texto) =>
  texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const COMPARADORES = {
  'lp-desc': (a, b) => b.lp - a.lp,
  'lp-asc': (a, b) => a.lp - b.lp,
  'wr-desc': (a, b) => (b.winrate ?? -1) - (a.winrate ?? -1),
  'partidas-desc': (a, b) => b.partidas - a.partidas,
  'nombre-asc': (a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es'),
};

function jugadoresVisibles() {
  const termino = plegar(estado.busqueda.trim());
  let lista = estado.listado.jugadores;

  if (termino) {
    lista = lista.filter((j) => j.riotId && plegar(j.riotId).includes(termino));
  }

  const comparador = COMPARADORES[estado.orden] ?? COMPARADORES['lp-desc'];
  return [...lista].sort(comparador);
}

/* ------------------------------------------------------------------ *
 * Pintado
 * ------------------------------------------------------------------ */

function pintarSubCabecera() {
  nodos.subCabecera.textContent = t('app.sub', { region: t(`region.${estado.region}`) });
}

function pintar() {
  const visibles = jugadoresVisibles();
  const hayDatos = estado.listado.jugadores.length > 0;

  pintarSubCabecera();
  renderTitulo(nodos.tituloTabla, estado);
  renderEstado(nodos.estado, {
    listado: estado.listado,
    enLinea: navigator.onLine,
    cargando: estado.cargando,
  });

  nodos.cargando.hidden = !estado.cargando;
  nodos.botonActualizar.dataset.cargando = estado.cargando ? 'si' : 'no';
  nodos.botonActualizar.disabled = estado.cargando;

  // La division solo existe bajo Maestro.
  nodos.controlDivision.hidden = TIERS_APEX.has(estado.tier);

  if (estado.cargando && !hayDatos) {
    renderEsqueleto(nodos.cuerpoTabla);
    nodos.podio.replaceChildren();
    nodos.vacio.hidden = true;
    nodos.conteo.textContent = '';
    nodos.notaNombres.hidden = true;
    return;
  }

  // El podio siempre muestra el top 3 real del ladder, no del filtro.
  const topLadder = [...estado.listado.jugadores].sort((a, b) => a.puesto - b.puesto);
  renderPodio(nodos.podio, topLadder);

  renderResumen(nodos.metricas, estado.listado.jugadores);
  renderTabla(nodos.cuerpoTabla, visibles);
  renderConteo(nodos.conteo, nodos.notaNombres, {
    visibles: visibles.length,
    total: estado.listado.jugadores.length,
    busqueda: estado.busqueda.trim(),
    nombresPendientes: estado.listado.nombresPendientes,
  });

  if (visibles.length === 0) {
    nodos.vacio.hidden = false;
    nodos.vacio.textContent = hayDatos ? t('vacio.busqueda') : t('vacio.sinDatos');
  } else {
    nodos.vacio.hidden = true;
  }
}

/* ------------------------------------------------------------------ *
 * Carga de datos
 * ------------------------------------------------------------------ */

let peticionEnCurso = 0;

async function cargar() {
  const miPeticion = ++peticionEnCurso;
  estado.cargando = true;
  pintar();

  try {
    const listado = await obtenerRanking({
      region: estado.region,
      cola: estado.cola,
      tier: estado.tier,
      division: estado.division,
      omitirRed: !navigator.onLine,
    });

    // Si el usuario cambio de filtro mientras esperabamos, descartamos.
    if (miPeticion !== peticionEnCurso) return;
    estado.listado = listado;
  } catch (error) {
    if (miPeticion !== peticionEnCurso) return;
    console.error('[Ranking LAN] no se pudo obtener el ranking:', error);
    estado.listado = {
      ...listadoVacio,
      region: estado.region,
      cola: estado.cola,
      tier: estado.tier,
      division: estado.division,
    };
  } finally {
    if (miPeticion === peticionEnCurso) {
      estado.cargando = false;
      pintar();
    }
  }
}

/* ------------------------------------------------------------------ *
 * Selector de region (las etiquetas dependen del idioma)
 * ------------------------------------------------------------------ */

function poblarRegiones() {
  const opciones = REGIONES.map((id) => {
    const opcion = document.createElement('option');
    opcion.value = id;
    opcion.textContent = t(`region.${id}`);
    return opcion;
  });
  nodos.selRegion.replaceChildren(...opciones);
  nodos.selRegion.value = estado.region;
}

/* ------------------------------------------------------------------ *
 * Eventos
 * ------------------------------------------------------------------ */

nodos.selRegion.addEventListener('change', () => {
  estado.region = nodos.selRegion.value;
  guardarPreferencias();
  cargar();
  // La seccion Mi grupo consulta los rangos en la region activa.
  dispatchEvent(new CustomEvent('regioncambiada', { detail: { region: estado.region } }));
});

nodos.selCola.addEventListener('change', () => {
  estado.cola = nodos.selCola.value;
  guardarPreferencias();
  cargar();
});

nodos.selTier.addEventListener('change', () => {
  estado.tier = nodos.selTier.value;
  guardarPreferencias();
  cargar();
});

nodos.selDivision.addEventListener('change', () => {
  estado.division = nodos.selDivision.value;
  guardarPreferencias();
  cargar();
});

nodos.selOrden.addEventListener('change', () => {
  estado.orden = nodos.selOrden.value;
  guardarPreferencias();
  pintar();
});

let relojBusqueda;
nodos.buscar.addEventListener('input', () => {
  clearTimeout(relojBusqueda);
  relojBusqueda = setTimeout(() => {
    estado.busqueda = nodos.buscar.value;
    pintar();
  }, 180);
});

nodos.botonActualizar.addEventListener('click', () => cargar());

/* Apertura del detalle: delegacion desde la tabla y el podio, por puesto
   (el riotId puede ser null mientras el proxy resuelve nombres). */
function abrirPorPuesto(puesto) {
  const jugador = estado.listado.jugadores.find((j) => j.puesto === puesto);
  if (!jugador) return;
  abrirDetalle(nodos.dialogo, nodos.dialogoNodos, jugador, {
    cola: estado.listado.cola,
    region: estado.listado.region,
    totalListado: estado.listado.total,
  });
}

nodos.cuerpoTabla.addEventListener('click', (evento) => {
  const fila = evento.target.closest('tr[data-puesto]');
  if (fila) abrirPorPuesto(Number(fila.dataset.puesto));
});

nodos.podio.addEventListener('click', (evento) => {
  const tarjeta = evento.target.closest('[data-puesto]');
  if (tarjeta) abrirPorPuesto(Number(tarjeta.dataset.puesto));
});

/* Conexion: al recuperar red, refrescamos; al perderla, solo repintamos. */
addEventListener('online', () => cargar());
addEventListener('offline', () => pintar());

/* Cambio de idioma: re-etiquetar selects dinamicos y repintar sin recargar. */
addEventListener('idiomacambiado', () => {
  poblarRegiones();
  pintar();
});

/* Al volver a la pestana, refrescamos si los datos ya tienen mas de 5 minutos. */
const CADUCIDAD_MS = 5 * 60 * 1000;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !navigator.onLine || estado.cargando) return;
  const marca = estado.listado.actualizado ? new Date(estado.listado.actualizado).getTime() : 0;
  if (Date.now() - marca > CADUCIDAD_MS) cargar();
});

/* Refresca el texto "hace N minutos" sin volver a pedir datos. */
setInterval(() => {
  if (!estado.cargando) {
    renderEstado(nodos.estado, {
      listado: estado.listado,
      enLinea: navigator.onLine,
      cargando: false,
    });
  }
}, 30_000);

/* ------------------------------------------------------------------ *
 * Pestanas: Ranking regional / Mi grupo
 * ------------------------------------------------------------------ */
const CLAVE_VISTA = 'ranking-lan:vista';

const pestanas = {
  global: { tab: $('#tab-global'), panel: $('#vista-global') },
  grupo: { tab: $('#tab-grupo'), panel: $('#vista-grupo') },
};

function activarVista(nombre) {
  const activa = nombre === 'grupo' ? 'grupo' : 'global';
  for (const [clave, { tab, panel }] of Object.entries(pestanas)) {
    const seleccionada = clave === activa;
    tab.setAttribute('aria-selected', String(seleccionada));
    tab.tabIndex = seleccionada ? 0 : -1;
    panel.hidden = !seleccionada;
  }
  try { localStorage.setItem(CLAVE_VISTA, activa); } catch { /* modo privado */ }
}

for (const [clave, { tab }] of Object.entries(pestanas)) {
  tab.addEventListener('click', () => activarVista(clave));
}

// Flechas entre pestanas, como pide el patron tablist de WAI-ARIA.
document.querySelector('.pestanas').addEventListener('keydown', (evento) => {
  if (evento.key !== 'ArrowLeft' && evento.key !== 'ArrowRight') return;
  const orden = [pestanas.global.tab, pestanas.grupo.tab];
  const actual = orden.indexOf(document.activeElement);
  if (actual === -1) return;
  const paso = evento.key === 'ArrowRight' ? 1 : orden.length - 1;
  const siguiente = orden[(actual + paso) % orden.length];
  siguiente.focus();
  siguiente.click();
});

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */
iniciarI18n();
leerPreferencias();
poblarRegiones();

const parametros = new URLSearchParams(location.search);

// La seccion del grupo importa ?amigos=... si llega de un enlace compartido.
const importados = iniciarGrupo(parametros);

// Vista inicial: enlace compartido > parametro ?vista > ultima usada.
let vistaInicial = 'global';
try {
  if (localStorage.getItem(CLAVE_VISTA) === 'grupo') vistaInicial = 'grupo';
} catch { /* modo privado */ }
const vistaParam = parametros.get('vista');
if (vistaParam === 'grupo' || vistaParam === 'global') vistaInicial = vistaParam;
if (importados > 0) vistaInicial = 'grupo';
activarVista(vistaInicial);

// Los parametros ya se aplicaron: limpiamos la URL para no re-importar amigos
// ni re-forzar la vista en la siguiente recarga.
if (location.search) history.replaceState(null, '', location.pathname);

// Reaplica las traducciones estaticas por si el idioma guardado no es 'es'.
aplicarEstaticos();

nodos.selCola.value = estado.cola;
nodos.selTier.value = estado.tier;
nodos.selDivision.value = estado.division;
nodos.selOrden.value = estado.orden;
cargar();

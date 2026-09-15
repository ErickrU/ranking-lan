/**
 * Seccion "Mi grupo": una clasificacion privada entre amigos, aparte del
 * ladder regional.
 *
 * - Los Riot ID se guardan SOLO en este dispositivo (localStorage).
 * - Los rangos se consultan en la REGION activa del selector global.
 * - Al abrir el detalle de un integrante se suma su mini historial de
 *   partidas (match-v5 via el proxy), la comparacion contra el promedio del
 *   grupo y consejos generados a partir de esos numeros reales.
 */

import {
  obtenerJugador,
  obtenerHistorial,
  ErrorDatos,
  COLAS,
  REGIONES,
  FUENTE,
  puntuacionRango,
  numero,
  tiempoRelativo,
} from './api.js';
import { t } from './i18n.js';
import {
  abrirDetalle,
  textoWinrate,
  claseWinrate,
  nombreRango,
  renderHistorial,
  renderComparacion,
  renderConsejos,
  renderExtraMensaje,
} from './ui.js';

const CLAVE_GRUPO = 'ranking-lan:grupo';

/** Cada integrante cuesta 2 llamadas a Riot: el limite protege la cuota. */
const MAX_MIEMBROS = 20;

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */
const $ = (selector) => document.querySelector(selector);

const nodos = {
  formulario: $('#form-amigo'),
  campoNombre: $('#campo-nombre'),
  campoTag: $('#campo-tag'),
  botonAgregar: $('#btn-agregar'),
  mensaje: $('#grupo-mensaje'),

  selCola: $('#grupo-cola'),
  botonActualizar: $('#btn-grupo-actualizar'),
  botonCompartir: $('#btn-grupo-compartir'),

  nota: $('#grupo-nota'),
  aviso: $('#grupo-aviso'),
  avisoTexto: $('#grupo-aviso-texto'),
  cuerpo: $('#grupo-cuerpo'),
  vacio: $('#grupo-vacio'),

  selRegionGlobal: $('#sel-region'),

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
const estado = {
  miembros: [],       // Riot IDs canonicos, en orden de alta
  cola: 'RANKED_SOLO_5x5',
  datos: new Map(),   // riotId en minusculas -> perfil normalizado | { error }
  cargando: false,
  ultimaCarga: null,
};

/** Region activa: la del selector global (los rangos dependen de ella). */
const regionActual = () => {
  const valor = nodos.selRegionGlobal?.value;
  return REGIONES.includes(valor) ? valor : 'la1';
};

function leer() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_GRUPO) ?? '{}');
    if (Array.isArray(guardado.miembros)) {
      estado.miembros = guardado.miembros
        .filter((m) => typeof m === 'string')
        .slice(0, MAX_MIEMBROS);
    }
    if (guardado.cola in COLAS) estado.cola = guardado.cola;
  } catch { /* localStorage bloqueado o JSON corrupto: grupo vacio */ }
}

function guardar() {
  try {
    localStorage.setItem(
      CLAVE_GRUPO,
      JSON.stringify({ miembros: estado.miembros, cola: estado.cola }),
    );
  } catch { /* modo privado: el grupo vive solo esta sesion */ }
}

/* ------------------------------------------------------------------ *
 * Riot ID
 * ------------------------------------------------------------------ */

const NOMBRE_VALIDO = (nombre) => nombre.length >= 1 && nombre.length <= 16 && !nombre.includes('#');
const TAG_VALIDO = (tag) => /^[\p{L}\p{N}]{2,5}$/u.test(tag);

/** Une nombre y tag ya validados en un Riot ID normalizado. */
const unirRiotId = (nombre, tag) => `${nombre}#${tag.toUpperCase()}`;

/** "nombre#tag" (enlaces compartidos) -> Riot ID normalizado o null. */
function validarRiotIdTexto(texto) {
  const pos = texto.lastIndexOf('#');
  if (pos <= 0) return null;
  const nombre = texto.slice(0, pos).trim();
  const tag = texto.slice(pos + 1).trim();
  if (!NOMBRE_VALIDO(nombre) || !TAG_VALIDO(tag)) return null;
  return unirRiotId(nombre, tag);
}

const claveDe = (riotId) => riotId.toLowerCase();
const yaEsta = (riotId) => estado.miembros.some((m) => claveDe(m) === claveDe(riotId));
const partesDe = (riotId) => {
  const pos = riotId.lastIndexOf('#');
  return pos > 0
    ? { nombre: riotId.slice(0, pos), tag: riotId.slice(pos + 1) }
    : { nombre: riotId, tag: '' };
};

/* ------------------------------------------------------------------ *
 * Mensajes de estado del formulario
 * ------------------------------------------------------------------ */
let relojMensaje;

function avisar(texto, tipo = 'info') {
  nodos.mensaje.textContent = texto;
  nodos.mensaje.dataset.tipo = tipo;
  clearTimeout(relojMensaje);
  if (texto) {
    relojMensaje = setTimeout(() => { nodos.mensaje.textContent = ''; }, 8000);
  }
}

/* ------------------------------------------------------------------ *
 * Altas, bajas y recargas
 * ------------------------------------------------------------------ */

async function agregar(nombreBruto, tagBruto) {
  const nombre = nombreBruto.trim();
  const tag = tagBruto.trim().replace(/^#/, '');

  if (!NOMBRE_VALIDO(nombre)) {
    avisar(`${t('msj.nombreInvalido')} ${t('msj.tagInvalido')}`, 'error');
    nodos.campoNombre.focus();
    return;
  }
  if (!TAG_VALIDO(tag)) {
    avisar(t('msj.tagInvalido'), 'error');
    nodos.campoTag.focus();
    return;
  }

  const riotId = unirRiotId(nombre, tag);
  if (yaEsta(riotId)) {
    avisar(t('msj.yaEsta', { riotId }), 'error');
    return;
  }
  if (estado.miembros.length >= MAX_MIEMBROS) {
    avisar(t('msj.limite', { max: MAX_MIEMBROS }), 'error');
    return;
  }

  nodos.botonAgregar.disabled = true;
  avisar(t('msj.consultando', { riotId }), 'info');

  try {
    const perfil = await obtenerJugador({
      riotId,
      region: regionActual(),
      omitirRed: !navigator.onLine,
    });

    // El servidor devuelve las mayusculas y minusculas oficiales de la cuenta.
    const canonico = perfil.riotId || riotId;
    if (yaEsta(canonico)) {
      avisar(t('msj.yaEsta', { riotId: canonico }), 'error');
      return;
    }

    estado.miembros.push(canonico);
    estado.datos.set(claveDe(canonico), perfil);
    estado.ultimaCarga = new Date().toISOString();
    guardar();
    render();
    avisar(t('msj.seUnio', { riotId: canonico }), 'ok');
    nodos.campoNombre.value = '';
    nodos.campoTag.value = '';
    nodos.campoNombre.focus();
  } catch (error) {
    if (error instanceof ErrorDatos && (error.estado === 404 || error.estado === 400)) {
      avisar(error.message, 'error');
    } else {
      avisar(t('msj.noComprobar', { error: error.message }), 'error');
    }
  } finally {
    nodos.botonAgregar.disabled = false;
  }
}

function quitar(riotId) {
  estado.miembros = estado.miembros.filter((m) => m !== riotId);
  estado.datos.delete(claveDe(riotId));
  guardar();
  render();
  avisar(t('msj.salio', { riotId }), 'info');
}

let peticionEnCurso = 0;

async function cargarTodos() {
  if (estado.miembros.length === 0) {
    render();
    return;
  }

  const mia = ++peticionEnCurso;
  estado.cargando = true;
  render();

  const region = regionActual();
  await Promise.allSettled(
    estado.miembros.map(async (riotId) => {
      try {
        const perfil = await obtenerJugador({ riotId, region, omitirRed: !navigator.onLine });
        if (mia === peticionEnCurso) estado.datos.set(claveDe(riotId), perfil);
      } catch (error) {
        if (mia === peticionEnCurso) {
          estado.datos.set(claveDe(riotId), { error: error.message, estado: error.estado ?? 0 });
        }
      }
    }),
  );

  if (mia !== peticionEnCurso) return;
  estado.cargando = false;
  estado.ultimaCarga = new Date().toISOString();
  render();
}

/* ------------------------------------------------------------------ *
 * Compartir e importar
 * ------------------------------------------------------------------ */

async function compartir() {
  if (estado.miembros.length === 0) {
    avisar(t('msj.compartirVacio'), 'error');
    return;
  }

  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('vista', 'grupo');
  url.searchParams.set('amigos', estado.miembros.join(','));

  try {
    if (navigator.share) {
      await navigator.share({ title: 'Ranking LAN', url: url.toString() });
      return;
    }
    await navigator.clipboard.writeText(url.toString());
    avisar(t('msj.enlaceCopiado'), 'ok');
  } catch (error) {
    if (error.name === 'AbortError') return; // el usuario cerro el dialogo del sistema
    avisar(t('msj.noCompartir', { error: error.message }), 'error');
  }
}

/** Importa ?amigos=a,b,c de un enlace compartido. Devuelve cuantos se sumaron. */
function importarDesdeUrl(parametros) {
  const lista = parametros.get('amigos');
  if (!lista) return 0;

  let nuevos = 0;
  for (const bruto of lista.split(',')) {
    const riotId = validarRiotIdTexto(bruto.trim());
    if (riotId && !yaEsta(riotId) && estado.miembros.length < MAX_MIEMBROS) {
      estado.miembros.push(riotId);
      nuevos++;
    }
  }
  if (nuevos > 0) guardar();
  return nuevos;
}

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

function elemento(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

function construirFila({ riotId, dato, entrada, puntos }, posicion) {
  const fila = elemento('tr');
  fila.dataset.riotId = riotId;
  fila.dataset.puntos = String(puntos);

  /* # ------------------------------------------------------------- */
  const celdaPuesto = elemento('td', 'col-puesto');
  celdaPuesto.append(
    elemento('span', posicion <= 3 && entrada ? 'puesto puesto--top' : 'puesto', String(posicion)),
  );

  /* Jugador ------------------------------------------------------- */
  const { nombre, tag } = partesDe(riotId);
  const celdaJugador = elemento('td');
  const envoltorio = elemento('div', 'celda-jugador');
  const linea = elemento('div');
  linea.append(elemento('span', 'jugador__nombre', nombre));
  if (tag) linea.append(elemento('span', 'jugador__tag', `#${tag}`));
  envoltorio.append(linea);

  if (entrada) {
    envoltorio.append(
      elemento(
        'span',
        'jugador__movil',
        `${numero(entrada.victorias)}V / ${numero(entrada.derrotas)}D · ${textoWinrate(entrada)}`,
      ),
    );
  }
  celdaJugador.append(envoltorio);

  /* Liga ----------------------------------------------------------- */
  const celdaLiga = elemento('td', 'col-liga');
  const rango = elemento('span', 'rango', dato?.error ? t('grupo.sinDatos') : nombreRango(entrada));
  rango.dataset.tier = entrada?.tier ?? '';
  if (dato?.error) rango.title = dato.error;
  celdaLiga.append(rango);

  /* LP -------------------------------------------------------------- */
  const celdaLp = elemento('td', 'col-lp');
  celdaLp.append(
    entrada ? elemento('span', 'lp', numero(entrada.lp)) : elemento('span', 'sin-dato', '—'),
  );

  /* V / D ------------------------------------------------------------ */
  const celdaVd = elemento(
    'td',
    'col-vd',
    entrada ? `${numero(entrada.victorias)} / ${numero(entrada.derrotas)}` : '—',
  );
  if (!entrada) celdaVd.classList.add('sin-dato');

  /* Winrate ----------------------------------------------------------- */
  const celdaWr = elemento('td', 'col-wr');
  celdaWr.append(
    entrada
      ? elemento('span', claseWinrate(entrada), textoWinrate(entrada))
      : elemento('span', 'sin-dato', '—'),
  );

  /* Quitar ------------------------------------------------------------ */
  const celdaQuitar = elemento('td', 'col-quitar');
  const botonQuitar = elemento('button', 'btn-quitar', '×');
  botonQuitar.type = 'button';
  botonQuitar.dataset.accion = 'quitar';
  botonQuitar.setAttribute('aria-label', t('grupo.quitarAria', { riotId }));
  celdaQuitar.append(botonQuitar);

  fila.append(celdaPuesto, celdaJugador, celdaLiga, celdaLp, celdaVd, celdaWr, celdaQuitar);
  return fila;
}

function filasOrdenadas() {
  const filas = estado.miembros.map((riotId) => {
    const dato = estado.datos.get(claveDe(riotId));
    const entrada = dato && !dato.error ? dato.colas?.[estado.cola] ?? null : null;
    return { riotId, dato, entrada, puntos: dato?.error ? -2 : puntuacionRango(entrada) };
  });
  filas.sort((a, b) => b.puntos - a.puntos || a.riotId.localeCompare(b.riotId, 'es'));
  return filas;
}

function renderNota(filas) {
  if (estado.miembros.length === 0) {
    nodos.nota.textContent = '';
    nodos.aviso.hidden = true;
    return;
  }
  if (estado.cargando) {
    nodos.nota.textContent = t('grupo.consultando');
    return;
  }

  const fuentes = new Set(
    filas.map(({ dato }) => (dato && !dato.error ? dato.fuente : null)).filter(Boolean),
  );

  let etiqueta = t('nota.sinDatos');
  if (fuentes.has(FUENTE.DEMO)) etiqueta = t('nota.demo');
  else if (fuentes.has(FUENTE.CACHE)) etiqueta = t('nota.cache');
  else if (fuentes.has(FUENTE.VIVO)) etiqueta = t('nota.vivo');

  const relativo = tiempoRelativo(estado.ultimaCarga);
  const cuantos = estado.miembros.length;
  nodos.nota.textContent =
    t('grupo.integrantes', { n: cuantos, plural: cuantos === 1 ? '' : 's' }) +
    ` · ${etiqueta}` +
    (relativo ? ` · ${t('nota.actualizado', { tiempo: relativo })}` : '');

  const esDemo = fuentes.has(FUENTE.DEMO);
  nodos.aviso.hidden = !esDemo;
  if (esDemo) {
    const conAviso = filas.find(({ dato }) => dato?.aviso);
    if (conAviso?.dato.aviso) nodos.avisoTexto.textContent = conAviso.dato.aviso;
  }
}

function render() {
  const hayMiembros = estado.miembros.length > 0;
  nodos.vacio.hidden = hayMiembros;
  nodos.botonActualizar.disabled = estado.cargando || !hayMiembros;
  nodos.botonActualizar.dataset.cargando = estado.cargando ? 'si' : 'no';

  const filas = filasOrdenadas();
  const fragmento = document.createDocumentFragment();
  filas.forEach((info, indice) => fragmento.append(construirFila(info, indice + 1)));
  nodos.cuerpo.replaceChildren(fragmento);

  renderNota(filas);
}

/* ------------------------------------------------------------------ *
 * Detalle: ficha + historial + comparacion + consejos
 * ------------------------------------------------------------------ */

/** Promedios del grupo (excluyendo al propio jugador) en la cola activa. */
function estadisticasGrupo(riotIdExcluido) {
  const otros = filasOrdenadas().filter(
    ({ riotId, entrada }) => entrada && claveDe(riotId) !== claveDe(riotIdExcluido),
  );
  if (otros.length === 0) return null;

  const media = (fn) => otros.reduce((suma, x) => suma + fn(x.entrada), 0) / otros.length;
  const mejor = otros.reduce((a, b) =>
    (b.entrada.winrate ?? -1) > (a.entrada.winrate ?? -1) ? b : a,
  );

  return {
    lpProm: media((e) => e.lp),
    wrProm: media((e) => e.winrate ?? 0),
    partidasProm: media((e) => e.partidas),
    mejor: { riotId: mejor.riotId, winrate: mejor.entrada.winrate },
    cuantos: otros.length,
  };
}

/** Consejos honestos: derivados de numeros reales, sin humo. */
function generarConsejos(entrada, historial, grupo, riotId) {
  const consejos = [];

  if (grupo) {
    const difWr = (entrada.winrate ?? 0) - grupo.wrProm;
    if (entrada.winrate !== null && difWr <= -3) {
      consejos.push(t('consejo.winrateBajo', {
        wr: entrada.winrate.toFixed(1),
        dif: Math.abs(difWr).toFixed(1),
      }));
    } else if (entrada.winrate !== null && difWr >= 3) {
      consejos.push(t('consejo.winrateAlto', { wr: entrada.winrate.toFixed(1) }));
    }

    if (entrada.partidas < grupo.partidasProm * 0.6) {
      consejos.push(t('consejo.pocasPartidas', {
        n: numero(entrada.partidas),
        prom: numero(Math.round(grupo.partidasProm)),
      }));
    }

    if (
      grupo.mejor.winrate !== null &&
      claveDe(grupo.mejor.riotId) !== claveDe(riotId) &&
      (entrada.winrate ?? 0) < grupo.mejor.winrate
    ) {
      consejos.push(t('consejo.duo', {
        nombre: partesDe(grupo.mejor.riotId).nombre,
        wr: grupo.mejor.winrate.toFixed(1),
      }));
    }
  }

  if (historial && historial.length > 0) {
    let derrotasSeguidas = 0;
    for (const p of historial) {
      if (p.victoria) break;
      derrotasSeguidas++;
    }
    if (derrotasSeguidas >= 3) {
      consejos.push(t('consejo.derrotas', { n: derrotasSeguidas }));
    }

    const muertesProm = historial.reduce((s, p) => s + p.d, 0) / historial.length;
    if (muertesProm > 6.5) {
      consejos.push(t('consejo.muereMenos', { muertes: muertesProm.toFixed(1) }));
    }

    const conCs = historial.filter((p) => p.cs > 0 && p.duracionSeg > 0 && p.posicion !== 'UTILITY');
    if (conCs.length > 0) {
      const csMin = conCs.reduce((s, p) => s + p.cs / (p.duracionSeg / 60), 0) / conCs.length;
      if (csMin < 5.5) consejos.push(t('consejo.farmea', { cs: csMin.toFixed(1) }));
    }
  }

  if (entrada.racha) consejos.push(t('consejo.racha'));
  if (entrada.inactivo) consejos.push(t('consejo.inactivo'));
  if (consejos.length === 0) consejos.push(t('consejo.general'));

  return consejos.slice(0, 4);
}

async function abrirDetalleDe(riotId, posicion) {
  const dato = estado.datos.get(claveDe(riotId));
  const entrada = dato && !dato.error ? dato.colas?.[estado.cola] : null;
  if (!entrada) return;

  const { nombre, tag } = partesDe(riotId);
  const region = regionActual();

  abrirDetalle(
    nodos.dialogo,
    nodos.dialogoNodos,
    { puesto: posicion, riotId, nombre, tag, ...entrada },
    { cola: estado.cola, region },
  );

  const extra = nodos.dialogoNodos.extra;

  /* Comparacion contra el grupo: inmediata, con lo que ya esta en memoria. */
  const grupo = estadisticasGrupo(riotId);
  if (grupo) {
    renderComparacion(extra, {
      difLp: entrada.lp - grupo.lpProm,
      difWr: (entrada.winrate ?? 0) - grupo.wrProm,
      puesto: posicion,
      total: estado.miembros.length,
    });
  }

  /* Historial: asincrono; si el dialogo se cierra o cambia, se descarta. */
  renderExtraMensaje(extra, t('historial.cargando'));
  const marcador = extra.querySelector('.dialogo__cargando');

  try {
    const historial = await obtenerHistorial({
      puuid: dato.puuid,
      riotId,
      region,
      omitirRed: !navigator.onLine,
    });
    if (!marcador.isConnected) return; // se abrio otra ficha mientras tanto
    marcador.remove();
    renderHistorial(extra, historial.partidas);
    renderConsejos(extra, generarConsejos(entrada, historial.partidas, grupo, riotId));
  } catch (error) {
    if (!marcador.isConnected) return;
    marcador.textContent = t('historial.error', { error: error.message });
    renderConsejos(extra, generarConsejos(entrada, null, grupo, riotId));
  }
}

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */

/**
 * Inicializa la seccion. Devuelve cuantos integrantes se importaron desde un
 * enlace compartido (?amigos=...), para que app.js decida abrir esta vista.
 */
export function iniciarGrupo(parametros = new URLSearchParams()) {
  leer();
  const importados = importarDesdeUrl(parametros);

  nodos.selCola.value = estado.cola;

  nodos.formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    agregar(nodos.campoNombre.value, nodos.campoTag.value);
  });

  nodos.selCola.addEventListener('change', () => {
    estado.cola = nodos.selCola.value;
    guardar();
    render(); // ambas colas ya estan en memoria: no hace falta volver a pedir
  });

  nodos.botonActualizar.addEventListener('click', () => cargarTodos());
  nodos.botonCompartir.addEventListener('click', () => compartir());

  nodos.cuerpo.addEventListener('click', (evento) => {
    const fila = evento.target.closest('tr[data-riot-id]');
    if (!fila) return;
    if (evento.target.closest('[data-accion="quitar"]')) {
      quitar(fila.dataset.riotId);
      return;
    }
    abrirDetalleDe(fila.dataset.riotId, fila.sectionRowIndex + 1);
  });

  addEventListener('online', () => {
    if (estado.miembros.length > 0) cargarTodos();
  });

  // La region del selector global tambien manda en el grupo.
  addEventListener('regioncambiada', () => {
    if (estado.miembros.length > 0) cargarTodos();
  });

  // Cambio de idioma: solo repintar (las cadenas salen de t()).
  addEventListener('idiomacambiado', () => render());

  render();
  if (estado.miembros.length > 0) cargarTodos();

  return importados;
}

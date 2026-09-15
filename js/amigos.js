/**
 * Seccion "Mi grupo": una clasificacion privada entre amigos, aparte del
 * ladder global de LAN.
 *
 * - Los Riot ID se guardan SOLO en este dispositivo (localStorage); no hay
 *   cuentas ni base de datos.
 * - Cada rango llega del proxy (/api/jugador) y queda en Cache Storage, asi
 *   que el grupo tambien se puede consultar sin conexion.
 * - "Compartir grupo" genera un enlace ?vista=grupo&amigos=... que, al
 *   abrirse, importa los miembros en el dispositivo de quien lo recibe.
 */

import {
  obtenerJugador,
  ErrorDatos,
  COLAS,
  TIERS,
  FUENTE,
  puntuacionRango,
  numero,
  tiempoRelativo,
} from './api.js';
import { abrirDetalle, textoWinrate, claseWinrate } from './ui.js';

const CLAVE_GRUPO = 'ranking-lan:grupo';

/** Cada integrante cuesta 2 llamadas a Riot: el limite protege la cuota. */
const MAX_MIEMBROS = 20;

const TIERS_ALTOS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */
const $ = (selector) => document.querySelector(selector);

const nodos = {
  formulario: $('#form-amigo'),
  campo: $('#campo-riot-id'),
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

  dialogo: $('#dialogo'),
  dialogoNodos: {
    titulo: $('#dialogo-titulo'),
    sub: $('#dialogo-sub'),
    datos: $('#dialogo-datos'),
    insignias: $('#dialogo-insignias'),
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

/** "nombre#tag" -> Riot ID normalizado (tag en mayusculas) o null. */
function validarRiotId(texto) {
  const pos = texto.lastIndexOf('#');
  if (pos <= 0) return null;
  const nombre = texto.slice(0, pos).trim();
  const tag = texto.slice(pos + 1).trim();
  if (nombre.length < 1 || nombre.length > 16 || nombre.includes('#')) return null;
  if (!/^[\p{L}\p{N}]{2,5}$/u.test(tag)) return null;
  return `${nombre}#${tag.toUpperCase()}`;
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

async function agregar(texto) {
  const riotId = validarRiotId(texto);
  if (!riotId) {
    avisar('Formato no válido: escribe Nombre#TAG (el tag tiene de 2 a 5 letras o números).', 'error');
    return;
  }
  if (yaEsta(riotId)) {
    avisar(`${riotId} ya está en el grupo.`, 'error');
    return;
  }
  if (estado.miembros.length >= MAX_MIEMBROS) {
    avisar(`El grupo admite hasta ${MAX_MIEMBROS} integrantes.`, 'error');
    return;
  }

  nodos.botonAgregar.disabled = true;
  avisar(`Consultando a ${riotId}…`, 'info');

  try {
    const perfil = await obtenerJugador({ riotId, omitirRed: !navigator.onLine });

    // El servidor devuelve las mayusculas y minusculas oficiales de la cuenta.
    const canonico = perfil.riotId || riotId;
    if (yaEsta(canonico)) {
      avisar(`${canonico} ya está en el grupo.`, 'error');
      return;
    }

    estado.miembros.push(canonico);
    estado.datos.set(claveDe(canonico), perfil);
    estado.ultimaCarga = new Date().toISOString();
    guardar();
    render();
    avisar(`${canonico} se unió al grupo.`, 'ok');
    nodos.campo.value = '';
  } catch (error) {
    if (error instanceof ErrorDatos && (error.estado === 404 || error.estado === 400)) {
      avisar(error.message, 'error');
    } else {
      avisar(`No se pudo comprobar ese Riot ID (${error.message}). Inténtalo con conexión.`, 'error');
    }
  } finally {
    nodos.botonAgregar.disabled = false;
    nodos.campo.focus();
  }
}

function quitar(riotId) {
  estado.miembros = estado.miembros.filter((m) => m !== riotId);
  estado.datos.delete(claveDe(riotId));
  guardar();
  render();
  avisar(`${riotId} salió del grupo.`, 'info');
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

  await Promise.allSettled(
    estado.miembros.map(async (riotId) => {
      try {
        const perfil = await obtenerJugador({ riotId, omitirRed: !navigator.onLine });
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
    avisar('Agrega al menos un integrante antes de compartir.', 'error');
    return;
  }

  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('vista', 'grupo');
  url.searchParams.set('amigos', estado.miembros.join(','));

  try {
    if (navigator.share) {
      await navigator.share({ title: 'Mi grupo · Ranking LAN', url: url.toString() });
      return;
    }
    await navigator.clipboard.writeText(url.toString());
    avisar('Enlace del grupo copiado al portapapeles.', 'ok');
  } catch (error) {
    if (error.name === 'AbortError') return; // el usuario cerro el dialogo del sistema
    avisar(`No se pudo compartir: ${error.message}`, 'error');
  }
}

/** Importa ?amigos=a,b,c de un enlace compartido. Devuelve cuantos se sumaron. */
function importarDesdeUrl(parametros) {
  const lista = parametros.get('amigos');
  if (!lista) return 0;

  let nuevos = 0;
  for (const bruto of lista.split(',')) {
    const riotId = validarRiotId(bruto.trim());
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

/** "Oro II", "Retador" (la elite no muestra division) o "Sin clasificar". */
const nombreRango = (entrada) =>
  entrada
    ? `${TIERS[entrada.tier] ?? entrada.tier}${TIERS_ALTOS.has(entrada.tier) ? '' : ` ${entrada.division}`}`
    : 'Sin clasificar';

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
  const rango = elemento('span', 'rango', dato?.error ? 'Sin datos' : nombreRango(entrada));
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
  botonQuitar.setAttribute('aria-label', `Quitar a ${riotId} del grupo`);
  celdaQuitar.append(botonQuitar);

  fila.append(celdaPuesto, celdaJugador, celdaLiga, celdaLp, celdaVd, celdaWr, celdaQuitar);
  return fila;
}

const ETIQUETAS_FUENTE = {
  [FUENTE.VIVO]: 'datos en vivo',
  [FUENTE.CACHE]: 'incluye datos de caché',
  [FUENTE.DEMO]: 'datos de demostración',
};

function renderNota(filas) {
  if (estado.miembros.length === 0) {
    nodos.nota.textContent = '';
    nodos.aviso.hidden = true;
    return;
  }
  if (estado.cargando) {
    nodos.nota.textContent = 'Consultando rangos…';
    return;
  }

  const fuentes = new Set(
    filas.map(({ dato }) => (dato && !dato.error ? dato.fuente : null)).filter(Boolean),
  );

  let etiqueta = 'sin datos';
  if (fuentes.has(FUENTE.DEMO)) etiqueta = ETIQUETAS_FUENTE[FUENTE.DEMO];
  else if (fuentes.has(FUENTE.CACHE)) etiqueta = ETIQUETAS_FUENTE[FUENTE.CACHE];
  else if (fuentes.has(FUENTE.VIVO)) etiqueta = ETIQUETAS_FUENTE[FUENTE.VIVO];

  const relativo = tiempoRelativo(estado.ultimaCarga);
  const cuantos = estado.miembros.length;
  nodos.nota.textContent =
    `${cuantos} integrante${cuantos === 1 ? '' : 's'} · ${etiqueta}` +
    (relativo ? ` · actualizado ${relativo}` : '');

  const esDemo = fuentes.has(FUENTE.DEMO);
  nodos.aviso.hidden = !esDemo;
  if (esDemo) {
    const conAviso = filas.find(({ dato }) => dato?.aviso);
    nodos.avisoTexto.textContent =
      conAviso?.dato.aviso ??
      'Los rangos del grupo son ficticios: configura una RIOT_API_KEY para ver los reales.';
  }
}

function render() {
  const hayMiembros = estado.miembros.length > 0;
  nodos.vacio.hidden = hayMiembros;
  nodos.botonActualizar.disabled = estado.cargando || !hayMiembros;
  nodos.botonActualizar.dataset.cargando = estado.cargando ? 'si' : 'no';

  // Liga > division > LP; errores al final; empates por nombre.
  const filas = estado.miembros.map((riotId) => {
    const dato = estado.datos.get(claveDe(riotId));
    const entrada = dato && !dato.error ? dato.colas?.[estado.cola] ?? null : null;
    return { riotId, dato, entrada, puntos: dato?.error ? -2 : puntuacionRango(entrada) };
  });
  filas.sort((a, b) => b.puntos - a.puntos || a.riotId.localeCompare(b.riotId, 'es'));

  const fragmento = document.createDocumentFragment();
  filas.forEach((info, indice) => fragmento.append(construirFila(info, indice + 1)));
  nodos.cuerpo.replaceChildren(fragmento);

  renderNota(filas);
}

/* ------------------------------------------------------------------ *
 * Detalle (reutiliza el dialogo de la vista global)
 * ------------------------------------------------------------------ */

function abrirDetalleDe(riotId, posicion) {
  const dato = estado.datos.get(claveDe(riotId));
  const entrada = dato && !dato.error ? dato.colas?.[estado.cola] : null;
  if (!entrada) return;

  const { nombre, tag } = partesDe(riotId);
  abrirDetalle(
    nodos.dialogo,
    nodos.dialogoNodos,
    { puesto: posicion, riotId, nombre, tag, ...entrada },
    { cola: estado.cola, regionNombre: 'Latinoamérica Norte · Mi grupo' },
  );
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
    agregar(nodos.campo.value);
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

  render();
  if (estado.miembros.length > 0) cargarTodos();

  return importados;
}

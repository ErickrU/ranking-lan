/**
 * Renderizado de Ranking LAN.
 *
 * Todo el texto que viene de la API se inserta con textContent, nunca con
 * innerHTML: un Riot ID puede contener cualquier caracter y no queremos que el
 * marcado dependa de datos externos.
 */

import { COLAS, TIERS, FUENTE, numero, tiempoRelativo, fechaCompleta } from './api.js';

const MEDALLAS = ['🥇', '🥈', '🥉'];

/* ------------------------------------------------------------------ *
 * Helpers de construccion de nodos
 * ------------------------------------------------------------------ */
function elemento(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

/** Winrate formateado con una decimal, o guion si no hay partidas. */
export function textoWinrate(jugador) {
  return jugador.winrate === null ? '—' : `${jugador.winrate.toFixed(1)} %`;
}

export function claseWinrate(jugador) {
  if (jugador.winrate === null) return 'wr';
  if (jugador.winrate >= 55) return 'wr wr--alto';
  if (jugador.winrate < 50) return 'wr wr--bajo';
  return 'wr';
}

/** Insignias derivadas de las banderas que expone league-v4. */
function insigniasDe(jugador) {
  const lista = [];
  if (jugador.racha) lista.push(['racha', '🔥 En racha']);
  if (jugador.veterano) lista.push(['veterano', 'Veterano']);
  if (jugador.nuevo) lista.push(['nuevo', 'Recién llegado']);
  if (jugador.inactivo) lista.push(['inactivo', 'Inactivo']);
  return lista;
}

function nodosInsignias(jugador) {
  return insigniasDe(jugador).map(([tipo, texto]) =>
    elemento('span', `insignia insignia--${tipo}`, texto),
  );
}

/* ------------------------------------------------------------------ *
 * Tabla
 * ------------------------------------------------------------------ */

/**
 * Pinta las filas del ranking.
 * @param {HTMLElement} cuerpo  el <tbody>
 * @param {Array} jugadores
 */
export function renderTabla(cuerpo, jugadores) {
  const fragmento = document.createDocumentFragment();

  for (const jugador of jugadores) {
    const fila = elemento('tr');
    fila.dataset.riotId = jugador.riotId;

    /* # ---------------------------------------------------------- */
    const celdaPuesto = elemento('td', 'col-puesto');
    const puesto = elemento('span', jugador.puesto <= 3 ? 'puesto puesto--top' : 'puesto', `${jugador.puesto}`);
    celdaPuesto.append(puesto);

    /* Jugador --------------------------------------------------- */
    const celdaJugador = elemento('td');
    const envoltorio = elemento('div', 'celda-jugador');

    // Boton real: es el objetivo de teclado que abre el detalle.
    const boton = elemento('button', 'enlace-jugador');
    boton.type = 'button';
    boton.dataset.accion = 'detalle';
    boton.setAttribute('aria-label', `Ver detalle de ${jugador.riotId}`);
    boton.append(elemento('span', 'jugador__nombre', jugador.nombre));
    if (jugador.tag) boton.append(elemento('span', 'jugador__tag', `#${jugador.tag}`));

    const linea = elemento('div');
    linea.append(boton);
    for (const insignia of nodosInsignias(jugador).slice(0, 1)) linea.append(insignia);
    envoltorio.append(linea);

    // Solo visible en pantallas angostas, donde V/D y winrate se ocultan.
    envoltorio.append(
      elemento(
        'span',
        'jugador__movil',
        `${numero(jugador.victorias)}V / ${numero(jugador.derrotas)}D · ${textoWinrate(jugador)}`,
      ),
    );
    celdaJugador.append(envoltorio);

    /* LP -------------------------------------------------------- */
    const celdaLp = elemento('td', 'col-lp');
    celdaLp.append(elemento('span', 'lp', numero(jugador.lp)));

    /* V / D ----------------------------------------------------- */
    const celdaVd = elemento('td', 'col-vd', `${numero(jugador.victorias)} / ${numero(jugador.derrotas)}`);

    /* Winrate --------------------------------------------------- */
    const celdaWr = elemento('td', 'col-wr');
    celdaWr.append(elemento('span', claseWinrate(jugador), textoWinrate(jugador)));

    fila.append(celdaPuesto, celdaJugador, celdaLp, celdaVd, celdaWr);
    fragmento.append(fila);
  }

  cuerpo.replaceChildren(fragmento);
}

/** Filas fantasma mientras se consulta el ladder. */
export function renderEsqueleto(cuerpo, filas = 8) {
  const fragmento = document.createDocumentFragment();
  for (let i = 0; i < filas; i++) {
    const fila = elemento('tr', 'esqueleto');
    fila.setAttribute('aria-hidden', 'true');
    for (let c = 0; c < 5; c++) {
      const celda = elemento('td');
      celda.append(elemento('span'));
      fila.append(celda);
    }
    fragmento.append(fila);
  }
  cuerpo.replaceChildren(fragmento);
}

/* ------------------------------------------------------------------ *
 * Podio
 * ------------------------------------------------------------------ */

export function renderPodio(contenedor, jugadores) {
  const fragmento = document.createDocumentFragment();

  for (const jugador of jugadores.slice(0, 3)) {
    const tarjeta = elemento('button', 'podio__tarjeta');
    tarjeta.type = 'button';
    tarjeta.dataset.riotId = jugador.riotId;
    tarjeta.dataset.puesto = `${jugador.puesto}`;
    tarjeta.dataset.accion = 'detalle';
    tarjeta.setAttribute('aria-label', `Puesto ${jugador.puesto}: ${jugador.riotId}, ${jugador.lp} LP`);

    tarjeta.append(elemento('span', 'podio__medalla', MEDALLAS[jugador.puesto - 1] ?? '🏅'));

    const centro = elemento('div');
    const nombre = elemento('div', 'podio__nombre');
    nombre.append(document.createTextNode(jugador.nombre));
    if (jugador.tag) nombre.append(elemento('span', 'podio__tag', ` #${jugador.tag}`));
    centro.append(nombre);
    centro.append(
      elemento(
        'div',
        'podio__detalle',
        `${numero(jugador.partidas)} partidas · ${textoWinrate(jugador)} de victorias`,
      ),
    );
    tarjeta.append(centro);

    const lp = elemento('div', 'podio__lp');
    lp.append(document.createTextNode(numero(jugador.lp)));
    lp.append(elemento('small', null, 'LP'));
    tarjeta.append(lp);

    fragmento.append(tarjeta);
  }

  contenedor.replaceChildren(fragmento);
}

/* ------------------------------------------------------------------ *
 * Resumen de metricas
 * ------------------------------------------------------------------ */

export function renderResumen(nodos, jugadores) {
  if (jugadores.length === 0) {
    nodos.total.textContent = '0';
    nodos.lpMax.textContent = '—';
    nodos.lpMin.textContent = '—';
    nodos.winrate.textContent = '—';
    return;
  }

  const lps = jugadores.map((j) => j.lp);
  const conPartidas = jugadores.filter((j) => j.winrate !== null);
  const winratePromedio =
    conPartidas.length > 0
      ? conPartidas.reduce((suma, j) => suma + j.winrate, 0) / conPartidas.length
      : null;

  nodos.total.textContent = numero(jugadores.length);
  nodos.lpMax.textContent = numero(Math.max(...lps));
  // El minimo del listado recibido. No es el corte oficial de la liga, porque el
  // servidor recorta el ladder al top solicitado.
  nodos.lpMin.textContent = numero(Math.min(...lps));
  nodos.winrate.textContent = winratePromedio === null ? '—' : `${winratePromedio.toFixed(1)} %`;
}

/* ------------------------------------------------------------------ *
 * Barra de estado
 * ------------------------------------------------------------------ */

const ETIQUETAS_FUENTE = {
  [FUENTE.VIVO]: 'Datos en vivo',
  [FUENTE.CACHE]: 'Desde caché',
  [FUENTE.DEMO]: 'Datos demo',
};

export function renderEstado(nodos, { listado, enLinea, cargando }) {
  /* Conexion */
  nodos.chipConexion.dataset.estado = enLinea ? 'en-linea' : 'sin-conexion';
  nodos.chipConexion.querySelector('.chip__texto').textContent = enLinea ? 'En línea' : 'Sin conexión';

  /* Fuente de los datos */
  if (cargando) {
    nodos.chipFuente.dataset.fuente = 'cargando';
    nodos.chipFuente.querySelector('.chip__texto').textContent = 'Cargando…';
  } else {
    nodos.chipFuente.dataset.fuente = listado.fuente;
    nodos.chipFuente.querySelector('.chip__texto').textContent =
      ETIQUETAS_FUENTE[listado.fuente] ?? listado.fuente;
  }

  /* Marca de tiempo */
  const relativo = tiempoRelativo(listado.actualizado);
  nodos.tiempo.textContent = relativo ? `Actualizado ${relativo}` : '';
  nodos.tiempo.title = fechaCompleta(listado.actualizado);

  /* Aviso de demostracion */
  const esDemo = listado.fuente === FUENTE.DEMO;
  nodos.aviso.hidden = !esDemo;
  if (esDemo) {
    nodos.avisoTexto.textContent =
      listado.aviso ??
      'Los Riot ID mostrados son ficticios. Arranca el proxy con una RIOT_API_KEY para ver el ladder real de LAN.';
  }
}

/* ------------------------------------------------------------------ *
 * Titulos y conteos
 * ------------------------------------------------------------------ */

export function renderTitulo(nodo, { cola, tier }) {
  nodo.textContent = `${TIERS[tier] ?? tier} · ${COLAS[cola] ?? cola}`;
}

export function renderConteo(nodo, { visibles, total, busqueda }) {
  if (busqueda) {
    nodo.textContent =
      visibles === 0
        ? `Sin resultados para "${busqueda}"`
        : `${numero(visibles)} de ${numero(total)} jugadores coinciden con "${busqueda}"`;
  } else {
    nodo.textContent = `${numero(total)} jugadores en el listado`;
  }
}

/* ------------------------------------------------------------------ *
 * Dialogo de detalle
 * ------------------------------------------------------------------ */

export function abrirDetalle(dialogo, nodos, jugador, listado) {
  nodos.titulo.textContent = jugador.riotId;
  nodos.sub.textContent =
    `Puesto ${jugador.puesto} · ${TIERS[jugador.tier] ?? jugador.tier} ${jugador.division} · ` +
    `${COLAS[listado.cola] ?? listado.cola} · ${listado.regionNombre}`;

  const filas = [
    ['Puntos de liga (LP)', numero(jugador.lp)],
    ['Partidas jugadas', numero(jugador.partidas)],
    ['Victorias', numero(jugador.victorias)],
    ['Derrotas', numero(jugador.derrotas)],
    ['Winrate', textoWinrate(jugador)],
  ];

  const fragmento = document.createDocumentFragment();
  for (const [etiqueta, valor] of filas) {
    fragmento.append(elemento('dt', null, etiqueta));
    fragmento.append(elemento('dd', null, valor));
  }

  // Barra visual de winrate.
  if (jugador.winrate !== null) {
    const barra = elemento('div', 'barra');
    const relleno = elemento('span');
    relleno.style.width = `${jugador.winrate.toFixed(1)}%`;
    barra.append(relleno);
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label', `${textoWinrate(jugador)} de victorias`);
    fragmento.append(barra);
  }

  nodos.datos.replaceChildren(fragmento);
  nodos.insignias.replaceChildren(...nodosInsignias(jugador));

  if (typeof dialogo.showModal === 'function') dialogo.showModal();
  else dialogo.setAttribute('open', '');
}

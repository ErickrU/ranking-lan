/**
 * Renderizado de Ranking LAN.
 *
 * Todo el texto que viene de la API se inserta con textContent, nunca con
 * innerHTML: un Riot ID puede contener cualquier caracter y no queremos que el
 * marcado dependa de datos externos. Todas las cadenas visibles pasan por t().
 */

import { FUENTE, numero, tiempoRelativo, fechaCompleta } from './api.js';
import { t } from './i18n.js';

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

/** "Oro II", "Retador" (la elite no muestra division) o "Sin clasificar". */
const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
export function nombreRango(entrada) {
  if (!entrada) return t('tier.UNRANKED');
  const liga = t(`tier.${entrada.tier}`);
  return APEX.has(entrada.tier) ? liga : `${liga} ${entrada.division}`;
}

/** Nombre visible de un jugador del listado (o marcador si aun no resuelve). */
function nombreVisible(jugador) {
  return jugador.nombre ?? `${t('tabla.invocador')} #${jugador.puesto}`;
}

/** Insignias derivadas de las banderas que expone league-v4. */
function insigniasDe(jugador) {
  const lista = [];
  if (jugador.racha) lista.push(['racha', t('insignia.racha')]);
  if (jugador.veterano) lista.push(['veterano', t('insignia.veterano')]);
  if (jugador.nuevo) lista.push(['nuevo', t('insignia.nuevo')]);
  if (jugador.inactivo) lista.push(['inactivo', t('insignia.inactivo')]);
  return lista;
}

function nodosInsignias(jugador) {
  return insigniasDe(jugador).map(([tipo, texto]) =>
    elemento('span', `insignia insignia--${tipo}`, texto),
  );
}

/* ------------------------------------------------------------------ *
 * Tabla global
 * ------------------------------------------------------------------ */

/**
 * Pinta las filas del ranking. Cada fila lleva data-puesto para abrir el
 * detalle (el riotId puede ser null mientras el proxy resuelve nombres).
 */
export function renderTabla(cuerpo, jugadores) {
  const fragmento = document.createDocumentFragment();

  for (const jugador of jugadores) {
    const fila = elemento('tr');
    fila.dataset.puesto = String(jugador.puesto);

    /* # ---------------------------------------------------------- */
    const celdaPuesto = elemento('td', 'col-puesto');
    celdaPuesto.append(
      elemento('span', jugador.puesto <= 3 ? 'puesto puesto--top' : 'puesto', `${jugador.puesto}`),
    );

    /* Jugador --------------------------------------------------- */
    const celdaJugador = elemento('td');
    const envoltorio = elemento('div', 'celda-jugador');

    const boton = elemento('button', 'enlace-jugador');
    boton.type = 'button';
    boton.dataset.accion = 'detalle';
    boton.setAttribute('aria-label', t('detalle.abrirAria', { riotId: jugador.riotId ?? nombreVisible(jugador) }));

    const nombre = elemento('span', 'jugador__nombre', nombreVisible(jugador));
    if (!jugador.nombre) nombre.classList.add('jugador__nombre--pendiente');
    boton.append(nombre);
    if (jugador.tag) boton.append(elemento('span', 'jugador__tag', `#${jugador.tag}`));

    const linea = elemento('div');
    linea.append(boton);
    for (const insignia of nodosInsignias(jugador).slice(0, 1)) linea.append(insignia);
    envoltorio.append(linea);

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
    tarjeta.dataset.puesto = `${jugador.puesto}`;
    tarjeta.dataset.accion = 'detalle';
    tarjeta.setAttribute('aria-label', t('podio.tarjeta', {
      puesto: jugador.puesto,
      riotId: jugador.riotId ?? nombreVisible(jugador),
      lp: jugador.lp,
    }));

    tarjeta.append(elemento('span', 'podio__medalla', MEDALLAS[jugador.puesto - 1] ?? '🏅'));

    const centro = elemento('div');
    const nombre = elemento('div', 'podio__nombre');
    nombre.append(document.createTextNode(nombreVisible(jugador)));
    if (jugador.tag) nombre.append(elemento('span', 'podio__tag', ` #${jugador.tag}`));
    centro.append(nombre);
    centro.append(
      elemento('div', 'podio__detalle', t('podio.detalle', {
        partidas: numero(jugador.partidas),
        wr: textoWinrate(jugador),
      })),
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
  nodos.lpMin.textContent = numero(Math.min(...lps));
  nodos.winrate.textContent = winratePromedio === null ? '—' : `${winratePromedio.toFixed(1)} %`;
}

/* ------------------------------------------------------------------ *
 * Barra de estado
 * ------------------------------------------------------------------ */

export function renderEstado(nodos, { listado, enLinea, cargando }) {
  /* Conexion */
  nodos.chipConexion.dataset.estado = enLinea ? 'en-linea' : 'sin-conexion';
  nodos.chipConexion.querySelector('.chip__texto').textContent =
    enLinea ? t('conexion.enLinea') : t('conexion.sinConexion');

  /* Fuente de los datos */
  if (cargando) {
    nodos.chipFuente.dataset.fuente = 'cargando';
    nodos.chipFuente.querySelector('.chip__texto').textContent = t('fuente.cargando');
  } else {
    nodos.chipFuente.dataset.fuente = listado.fuente;
    nodos.chipFuente.querySelector('.chip__texto').textContent = t(`fuente.${listado.fuente}`);
  }

  /* Marca de tiempo */
  const relativo = tiempoRelativo(listado.actualizado);
  nodos.tiempo.textContent = relativo ? t('estado.actualizado', { tiempo: relativo }) : '';
  nodos.tiempo.title = fechaCompleta(listado.actualizado);

  /* Aviso de demostracion (el detalle del motivo llega del servidor) */
  const esDemo = listado.fuente === FUENTE.DEMO;
  nodos.aviso.hidden = !esDemo;
  if (esDemo && listado.aviso) nodos.avisoTexto.textContent = listado.aviso;
}

/* ------------------------------------------------------------------ *
 * Titulos y conteos
 * ------------------------------------------------------------------ */

export function renderTitulo(nodo, { region, cola, tier, division }) {
  const liga = APEX.has(tier) ? t(`tier.${tier}`) : `${t(`tier.${tier}`)} ${division}`;
  const regionCorta = t(`region.${region}`).split(' · ')[0];
  nodo.textContent = `${liga} · ${t(`cola.${cola}`)} · ${regionCorta}`;
}

export function renderConteo(nodo, notaNombres, { visibles, total, busqueda, nombresPendientes }) {
  if (busqueda) {
    nodo.textContent = visibles === 0
      ? t('conteo.sinResultados', { busqueda })
      : t('conteo.busqueda', { visibles: numero(visibles), total: numero(total), busqueda });
  } else {
    nodo.textContent = t('conteo.total', { total: numero(total) });
  }

  notaNombres.hidden = !nombresPendientes;
  if (nombresPendientes) {
    notaNombres.textContent = t('tabla.nombresPendientes', { n: numero(nombresPendientes) });
  }
}

/* ------------------------------------------------------------------ *
 * Dialogo de detalle
 * ------------------------------------------------------------------ */

/**
 * Abre el dialogo con la ficha de un jugador.
 *
 * @param contexto { cola, region, totalListado? } — con totalListado se
 *        calcula el percentil dentro del listado actual.
 */
export function abrirDetalle(dialogo, nodos, jugador, contexto) {
  nodos.titulo.textContent = jugador.riotId ?? nombreVisible(jugador);

  nodos.sub.textContent = [
    t('dialogo.puesto', { puesto: jugador.puesto }),
    nombreRango(jugador.tier ? jugador : null),
    t(`cola.${contexto.cola}`),
    t(`region.${contexto.region}`),
  ].join(' · ');

  const filas = [
    [t('dialogo.lp'), numero(jugador.lp)],
    [t('dialogo.partidas'), numero(jugador.partidas)],
    [t('dialogo.victorias'), numero(jugador.victorias)],
    [t('dialogo.derrotas'), numero(jugador.derrotas)],
    [t('dialogo.winrate'), textoWinrate(jugador)],
  ];

  const fragmento = document.createDocumentFragment();
  for (const [etiqueta, valor] of filas) {
    fragmento.append(elemento('dt', null, etiqueta));
    fragmento.append(elemento('dd', null, valor));
  }

  // Percentil dentro del listado actual (solo vista global).
  if (contexto.totalListado > 1) {
    const pct = Math.max(0.1, (jugador.puesto / contexto.totalListado) * 100);
    fragmento.append(elemento('dt', null, '📊'));
    fragmento.append(elemento('dd', null, t('dialogo.percentil', { pct: pct.toFixed(pct < 10 ? 1 : 0) })));
  }

  // Barra visual de winrate.
  if (jugador.winrate !== null) {
    const barra = elemento('div', 'barra');
    const relleno = elemento('span');
    relleno.style.width = `${jugador.winrate.toFixed(1)}%`;
    barra.append(relleno);
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label', t('dialogo.barra', { wr: textoWinrate(jugador) }));
    fragmento.append(barra);
  }

  nodos.datos.replaceChildren(fragmento);
  nodos.insignias.replaceChildren(...nodosInsignias(jugador));

  // Las secciones extra (historial/consejos del grupo) las llena amigos.js;
  // aqui se limpian para que la vista global no herede contenido.
  if (nodos.extra) nodos.extra.replaceChildren();

  if (typeof dialogo.showModal === 'function') dialogo.showModal();
  else dialogo.setAttribute('open', '');
}

/* ------------------------------------------------------------------ *
 * Historial y consejos (los usa amigos.js dentro del dialogo)
 * ------------------------------------------------------------------ */

/** Lista de partidas del historial (match-v5) ya normalizadas por el proxy. */
export function renderHistorial(contenedor, partidas) {
  const seccion = elemento('section', 'dialogo__seccion');
  seccion.append(elemento('h4', 'dialogo__subtitulo', t('historial.titulo')));

  if (!partidas || partidas.length === 0) {
    seccion.append(elemento('p', 'historial__vacio', t('historial.vacio')));
    contenedor.append(seccion);
    return;
  }

  const lista = elemento('ul', 'historial');
  for (const p of partidas) {
    const item = elemento('li', `historial__partida historial__partida--${p.victoria ? 'v' : 'd'}`);

    item.append(elemento('span', 'historial__resultado', p.victoria ? t('historial.v') : t('historial.d')));
    item.append(elemento('span', 'historial__campeon', p.campeon));

    const kda = elemento('span', 'historial__kda');
    kda.append(elemento('strong', null, `${p.k}/${p.d}/${p.a}`));
    item.append(kda);

    const extras = [];
    if (p.cs) extras.push(`${numero(p.cs)} CS`);
    if (p.duracionSeg) extras.push(t('historial.min', { min: Math.round(p.duracionSeg / 60) }));
    if (p.posicion && t(`posicion.${p.posicion}`) !== `posicion.${p.posicion}`) {
      extras.push(t(`posicion.${p.posicion}`));
    }
    item.append(elemento('span', 'historial__meta', extras.join(' · ')));

    if (p.terminada) {
      item.append(elemento('span', 'historial__cuando', tiempoRelativo(p.terminada)));
    }
    lista.append(item);
  }
  seccion.append(lista);
  contenedor.append(seccion);
}

/** Comparacion del jugador contra el promedio de su grupo. */
export function renderComparacion(contenedor, { difLp, difWr, puesto, total }) {
  const seccion = elemento('section', 'dialogo__seccion');
  seccion.append(elemento('h4', 'dialogo__subtitulo', t('comp.titulo')));

  const dl = elemento('dl', 'comparacion');
  const filas = [
    [t('comp.lp'), `${difLp >= 0 ? '+' : ''}${numero(Math.round(difLp))} LP`, difLp >= 0],
    [t('comp.wr'), t('comp.pts', { n: `${difWr >= 0 ? '+' : ''}${difWr.toFixed(1)}` }), difWr >= 0],
    [t('comp.puesto'), t('comp.de', { puesto, total }), puesto === 1],
  ];
  for (const [etiqueta, valor, positivo] of filas) {
    dl.append(elemento('dt', null, etiqueta));
    dl.append(elemento('dd', positivo ? 'comparacion__bien' : 'comparacion__mal', valor));
  }
  seccion.append(dl);
  contenedor.append(seccion);
}

/** Consejos generados en cliente a partir de datos reales del jugador/grupo. */
export function renderConsejos(contenedor, consejos) {
  if (!consejos || consejos.length === 0) return;
  const seccion = elemento('section', 'dialogo__seccion');
  seccion.append(elemento('h4', 'dialogo__subtitulo', t('consejos.titulo')));

  const lista = elemento('ul', 'consejos');
  for (const consejo of consejos) lista.append(elemento('li', 'consejos__item', consejo));
  seccion.append(lista);
  contenedor.append(seccion);
}

/** Mensaje de carga/estado ANEXADO a la zona extra del dialogo (no la vacia:
    la comparacion contra el grupo ya puede estar pintada encima). */
export function renderExtraMensaje(contenedor, texto) {
  contenedor.append(elemento('p', 'dialogo__cargando', texto));
}

/**
 * Renderizado de Ranking LAN.
 *
 * Todo el texto que viene de la API se inserta con textContent, nunca con
 * innerHTML: un Riot ID puede contener cualquier caracter y no queremos que el
 * marcado dependa de datos externos. Todas las cadenas visibles pasan por t().
 */

import {
  FUENTE, numero, tiempoRelativo, fechaCompleta,
  urlRetratoCampeon, urlIconoPerfil, urlItem, urlRuna, urlHechizo,
} from './api.js';
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

/** Retrato de campeon desde Data Dragon, con inicial como respaldo si no carga. */
export function retratoCampeon(campeon, version, clase = 'retrato') {
  const marco = elemento('span', clase);
  marco.dataset.inicial = (campeon || '?').slice(0, 1).toUpperCase();
  if (version && campeon && campeon !== '—') {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    // crossorigin hace la peticion CORS (Data Dragon lo permite): asi la
    // respuesta no es opaca y el service worker puede guardarla para offline.
    img.crossOrigin = 'anonymous';
    img.width = 40; img.height = 40;
    img.src = urlRetratoCampeon(campeon, version);
    img.addEventListener('error', () => img.remove(), { once: true });
    marco.append(img);
  }
  return marco;
}

/** Cabecera de perfil: icono, nivel y resumen de las ultimas partidas. */
export function renderPerfil(contenedor, { perfil, resumen, version }) {
  if (!perfil && !resumen) return;
  const seccion = elemento('section', 'dialogo__seccion perfil');

  if (perfil) {
    const identidad = elemento('div', 'perfil__identidad');
    const icono = elemento('span', 'perfil__icono');
    if (version && perfil.iconoId !== null && perfil.iconoId !== undefined) {
      const img = document.createElement('img');
      img.alt = '';
      img.crossOrigin = 'anonymous';
      img.width = 56; img.height = 56;
      img.src = urlIconoPerfil(perfil.iconoId, version);
      img.addEventListener('error', () => img.remove(), { once: true });
      icono.append(img);
    }
    if (perfil.nivel) {
      icono.append(elemento('span', 'perfil__nivel', numero(perfil.nivel)));
    }
    identidad.append(icono);
    seccion.append(identidad);
  }

  if (resumen) {
    const rejilla = elemento('div', 'perfil__stats');
    const stat = (valor, etiqueta, clase = '') => {
      const caja = elemento('div', `perfil__stat ${clase}`.trim());
      caja.append(elemento('strong', 'perfil__valor', valor));
      caja.append(elemento('span', 'perfil__etiqueta', etiqueta));
      return caja;
    };

    const kdaTexto = resumen.kda === Infinity ? '∞' : resumen.kda.toFixed(2);
    rejilla.append(stat(kdaTexto, t('perfil.kda'), resumen.kda >= 3 ? 'perfil__stat--bien' : resumen.kda < 2 ? 'perfil__stat--mal' : ''));
    rejilla.append(stat(
      `${resumen.kPromedio.toFixed(1)} / ${resumen.dPromedio.toFixed(1)} / ${resumen.aPromedio.toFixed(1)}`,
      t('perfil.promedioKda'),
    ));
    if (resumen.recientes7d.winrate !== null) {
      rejilla.append(stat(
        `${resumen.recientes7d.winrate.toFixed(0)} %`,
        t('perfil.wr7d', { n: resumen.recientes7d.partidas }),
        resumen.recientes7d.winrate >= 55 ? 'perfil__stat--bien' : resumen.recientes7d.winrate < 45 ? 'perfil__stat--mal' : '',
      ));
    }
    if (resumen.kpPromedio !== null) rejilla.append(stat(`${resumen.kpPromedio.toFixed(0)} %`, t('perfil.kp')));
    if (resumen.csMin !== null) rejilla.append(stat(resumen.csMin.toFixed(1), t('perfil.csMin')));
    if (resumen.visionMin !== null) rejilla.append(stat(resumen.visionMin.toFixed(2), t('perfil.visionMin')));
    seccion.append(rejilla);

    if (resumen.racha.n >= 2) {
      const racha = elemento('p', `perfil__racha perfil__racha--${resumen.racha.tipo}`,
        t(resumen.racha.tipo === 'victorias' ? 'perfil.rachaV' : 'perfil.rachaD', { n: resumen.racha.n }));
      seccion.append(racha);
    }
  }

  contenedor.append(seccion);
}

/** Campeones mas jugados en el historial, con winrate y KDA (estilo op.gg). */
export function renderCampeones(contenedor, campeones, version) {
  if (!campeones || campeones.length === 0) return;
  const seccion = elemento('section', 'dialogo__seccion');
  seccion.append(elemento('h4', 'dialogo__subtitulo', t('campeones.titulo')));

  const lista = elemento('ul', 'campeones');
  for (const c of campeones) {
    const item = elemento('li', 'campeones__item');
    item.append(retratoCampeon(c.campeon, version));

    const centro = elemento('div', 'campeones__centro');
    centro.append(elemento('strong', 'campeones__nombre', c.campeon));
    centro.append(elemento('span', 'campeones__meta',
      `${t('campeones.partidas', { n: c.partidas })} · KDA ${c.kda === Infinity ? '∞' : c.kda.toFixed(2)}`));
    item.append(centro);

    const wr = elemento('span', `campeones__wr ${c.winrate >= 55 ? 'wr--alto' : c.winrate < 50 ? 'wr--bajo' : ''}`.trim(),
      `${c.winrate.toFixed(0)} %`);
    item.append(wr);

    const barra = elemento('span', 'campeones__barra');
    const relleno = elemento('span');
    relleno.style.width = `${c.winrate.toFixed(0)}%`;
    barra.append(relleno);
    item.append(barra);

    lista.append(item);
  }
  seccion.append(lista);
  contenedor.append(seccion);
}

/** Reparto de roles del historial como barras horizontales. */
export function renderRoles(contenedor, roles) {
  if (!roles || roles.length === 0) return;
  const seccion = elemento('section', 'dialogo__seccion');
  seccion.append(elemento('h4', 'dialogo__subtitulo', t('roles.titulo')));

  const lista = elemento('ul', 'roles');
  for (const r of roles) {
    const nombre = t(`posicion.${r.rol}`) !== `posicion.${r.rol}` ? t(`posicion.${r.rol}`) : r.rol;
    const item = elemento('li', 'roles__item');
    item.append(elemento('span', 'roles__nombre', nombre));
    const barra = elemento('span', 'roles__barra');
    const relleno = elemento('span');
    relleno.style.width = `${r.pct.toFixed(0)}%`;
    barra.append(relleno);
    item.append(barra);
    item.append(elemento('span', 'roles__pct', `${r.pct.toFixed(0)} %`));
    lista.append(item);
  }
  seccion.append(lista);
  contenedor.append(seccion);
}

/** Top de maestria de campeones (champion-mastery-v4). */
export function renderMaestria(contenedor, maestria, version, indice) {
  if (!maestria || maestria.length === 0) return;
  const seccion = elemento('section', 'dialogo__seccion');
  seccion.append(elemento('h4', 'dialogo__subtitulo', t('maestria.titulo')));

  const lista = elemento('ul', 'maestria');
  for (const m of maestria) {
    const info = m.campeonId !== null && indice?.get(m.campeonId);
    const idInterno = info?.id ?? m.campeon ?? null;
    const nombre = info?.nombre ?? m.campeon ?? '—';

    const item = elemento('li', 'maestria__item');
    const retrato = retratoCampeon(idInterno, version, 'retrato retrato--sm');
    retrato.append(elemento('span', 'maestria__nivel', String(m.nivel)));
    item.append(retrato);
    item.append(elemento('span', 'maestria__nombre', nombre));
    item.append(elemento('span', 'maestria__puntos', t('maestria.puntos', { n: numero(m.puntos) })));
    lista.append(item);
  }
  seccion.append(lista);
  contenedor.append(seccion);
}

/** Lista de partidas del historial (match-v5) ya normalizadas por el proxy.
    Con catalogo, cada partida muestra ademas su build (items, hechizos, runa). */
export function renderHistorial(contenedor, partidas, version, catalogo = null) {
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
    item.append(retratoCampeon(p.campeon, version, 'retrato retrato--sm'));

    const centro = elemento('div', 'historial__centro');
    const linea1 = elemento('div', 'historial__linea');
    linea1.append(elemento('span', 'historial__campeon', p.campeon));
    const kda = elemento('span', 'historial__kda');
    kda.append(elemento('strong', null, `${p.k}/${p.d}/${p.a}`));
    linea1.append(kda);
    if (p.multikill >= 2) {
      linea1.append(elemento('span', 'historial__multi', t(`historial.multi${p.multikill}`)));
    }
    centro.append(linea1);

    const extras = [];
    if (p.posicion && t(`posicion.${p.posicion}`) !== `posicion.${p.posicion}`) extras.push(t(`posicion.${p.posicion}`));
    if (p.cs) extras.push(`${numero(p.cs)} CS`);
    if (typeof p.kp === 'number') extras.push(`${Math.round(p.kp * 100)} % KP`);
    if (p.dano) extras.push(`${numero(Math.round(p.dano / 1000))}k ${t('historial.dano')}`);
    if (p.duracionSeg) extras.push(t('historial.min', { min: Math.round(p.duracionSeg / 60) }));
    centro.append(elemento('span', 'historial__meta', extras.join(' · ')));
    if (catalogo) renderBuildPartida(centro, p, catalogo);
    item.append(centro);

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

/* ------------------------------------------------------------------ *
 * Builds: objetos, runas y hechizos (Data Dragon resuelve nombres e imagenes)
 * ------------------------------------------------------------------ */

/** Icono cuadrado de un objeto con tooltip de nombre y oro. */
export function iconoItem(id, catalogo, clase = 'item') {
  const info = catalogo?.items.get(id);
  const caja = elemento('span', clase);
  if (!id) { caja.classList.add('item--vacio'); return caja; }
  caja.title = info ? `${info.nombre}${info.oro ? ` · ${numero(info.oro)} g` : ''}${info.descripcion ? `\n${info.descripcion}` : ''}` : `#${id}`;
  caja.setAttribute('aria-label', info?.nombre ?? `#${id}`);
  const img = document.createElement('img');
  img.alt = '';
  img.crossOrigin = 'anonymous';
  img.loading = 'lazy';
  img.width = 36; img.height = 36;
  img.src = urlItem(id, catalogo.version);
  img.addEventListener('error', () => img.remove(), { once: true });
  caja.append(img);
  return caja;
}

export function iconoRuna(id, catalogo, clase = 'runa') {
  const info = catalogo?.runas.get(id);
  const caja = elemento('span', clase);
  if (!info) { caja.textContent = '?'; return caja; }
  caja.title = info.nombre;
  caja.setAttribute('aria-label', info.nombre);
  const img = document.createElement('img');
  img.alt = '';
  img.crossOrigin = 'anonymous';
  img.loading = 'lazy';
  img.src = urlRuna(info.icono);
  img.addEventListener('error', () => img.remove(), { once: true });
  caja.append(img);
  return caja;
}

export function iconoHechizo(key, catalogo, clase = 'hechizo') {
  const info = catalogo?.hechizos.get(key);
  const caja = elemento('span', clase);
  if (!info) { caja.textContent = '?'; return caja; }
  caja.title = info.nombre;
  caja.setAttribute('aria-label', info.nombre);
  const img = document.createElement('img');
  img.alt = '';
  img.crossOrigin = 'anonymous';
  img.loading = 'lazy';
  img.src = urlHechizo(info.idInterno, catalogo.version);
  img.addEventListener('error', () => img.remove(), { once: true });
  caja.append(img);
  return caja;
}

/** Fila compacta items + guardian + hechizos + runa clave (historial del grupo). */
export function renderBuildPartida(contenedor, partida, catalogo) {
  if (!catalogo || !partida.items) return;
  const fila = elemento('div', 'build-partida');
  const items = elemento('span', 'build-partida__items');
  for (const id of partida.items) items.append(iconoItem(id, catalogo, 'item item--sm'));
  if (partida.guardian) items.append(iconoItem(partida.guardian, catalogo, 'item item--sm item--guardian'));
  fila.append(items);

  const extras = elemento('span', 'build-partida__extras');
  for (const k of partida.hechizos ?? []) if (k) extras.append(iconoHechizo(k, catalogo, 'hechizo hechizo--sm'));
  if (partida.runas?.clave) extras.append(iconoRuna(partida.runas.clave, catalogo, 'runa runa--sm'));
  fila.append(extras);
  contenedor.append(fila);
}

/** Ficha completa de build agregada de un campeon. */
export function renderBuild(contenedor, { fuente, aviso, build, campeon, catalogo }) {
  if (aviso && fuente === FUENTE.DEMO) {
    const a = elemento('p', 'aviso aviso--mini');
    a.append(elemento('strong', null, t('aviso.demo')), document.createTextNode(` ${aviso}`));
    contenedor.append(a);
  }

  if (!build || !build.partidas) {
    contenedor.append(elemento('p', 'build__vacio', t('build.sinDatos')));
    return;
  }

  /* Cabecera: retrato grande + stats */
  const cab = elemento('section', 'dialogo__seccion build__cab');
  cab.append(retratoCampeon(campeon.idInterno, catalogo.version, 'retrato retrato--xl'));
  const stats = elemento('div', 'perfil__stats build__stats');
  const stat = (v, et, clase = '') => {
    const caja = elemento('div', `perfil__stat ${clase}`.trim());
    caja.append(elemento('strong', 'perfil__valor', v));
    caja.append(elemento('span', 'perfil__etiqueta', et));
    return caja;
  };
  stats.append(stat(`${build.winrate.toFixed(0)} %`, t('build.winrate'), build.winrate >= 52 ? 'perfil__stat--bien' : build.winrate < 48 ? 'perfil__stat--mal' : ''));
  if (build.kda !== null) stats.append(stat(build.kda.toFixed(2), t('build.kda')));
  const rol = build.roles?.[0]?.rol;
  if (rol) stats.append(stat(t(`posicion.${rol}`) !== `posicion.${rol}` ? t(`posicion.${rol}`) : rol, t('build.rol')));
  cab.append(stats);
  contenedor.append(cab);

  const muestra = elemento('p', `build__muestra ${build.partidas < 15 ? 'build__muestra--corta' : ''}`.trim(),
    build.partidas < 15 ? t('build.muestraCorta', { n: numero(build.partidas) }) : t('build.muestra', { n: numero(build.partidas) }));
  contenedor.append(muestra);

  /* Build final mas repetida */
  const conjunto = build.conjuntos?.[0];
  if (conjunto) {
    const s = elemento('section', 'dialogo__seccion');
    s.append(elemento('h4', 'dialogo__subtitulo', t('build.conjunto')));
    const fila = elemento('div', 'build__conjunto');
    // Se omiten consumibles y guardianes: no son "la build".
    for (const id of conjunto.items) {
      if (catalogo.items.get(id)?.consumible) continue;
      fila.append(iconoItem(id, catalogo));
    }
    s.append(fila);
    s.append(elemento('p', 'build__meta', `${t('build.veces', { n: conjunto.n })} · ${conjunto.winrate.toFixed(0)} % WR`));
    contenedor.append(s);
  }

  /* Objetos mas comprados */
  if (build.items?.length) {
    const s = elemento('section', 'dialogo__seccion');
    s.append(elemento('h4', 'dialogo__subtitulo', t('build.items')));
    const lista = elemento('ul', 'build__items');
    for (const it of build.items) {
      if (catalogo.items.get(it.id)?.consumible) continue;
      const li = elemento('li', 'build__item');
      li.append(iconoItem(it.id, catalogo));
      const txt = elemento('div', 'build__item-texto');
      txt.append(elemento('strong', null, catalogo.items.get(it.id)?.nombre ?? `#${it.id}`));
      txt.append(elemento('span', 'build__meta', `${t('build.pct', { n: Math.round((it.n / build.partidas) * 100) })} · ${it.winrate.toFixed(0)} % WR`));
      li.append(txt);
      lista.append(li);
    }
    s.append(lista);
    contenedor.append(s);
  }

  /* Runas */
  if (build.claves?.length) {
    const s = elemento('section', 'dialogo__seccion');
    s.append(elemento('h4', 'dialogo__subtitulo', t('build.runas')));
    const lista = elemento('ul', 'build__runas');
    for (const r of build.claves) {
      const li = elemento('li', 'build__runa');
      li.append(iconoRuna(r.id, catalogo, 'runa runa--lg'));
      const txt = elemento('div', 'build__item-texto');
      const nombre = catalogo.runas.get(r.id)?.nombre ?? `#${r.id}`;
      const arbolSec = catalogo.runas.get(r.secundario)?.nombre;
      txt.append(elemento('strong', null, nombre));
      txt.append(elemento('span', 'build__meta',
        `${arbolSec ? t('build.secundario', { arbol: arbolSec }) + ' · ' : ''}${t('build.pct', { n: Math.round((r.n / build.partidas) * 100) })} · ${r.winrate.toFixed(0)} % WR`));
      li.append(txt);
      if (r.secundario) li.append(iconoRuna(r.secundario, catalogo, 'runa runa--arbol'));
      lista.append(li);
    }
    s.append(lista);
    contenedor.append(s);
  }

  /* Hechizos */
  if (build.hechizos?.length) {
    const s = elemento('section', 'dialogo__seccion');
    s.append(elemento('h4', 'dialogo__subtitulo', t('build.hechizos')));
    const lista = elemento('ul', 'build__hechizos');
    for (const h of build.hechizos) {
      const li = elemento('li', 'build__hechizo');
      for (const k of h.ids) li.append(iconoHechizo(k, catalogo));
      li.append(elemento('span', 'build__meta', `${t('build.pct', { n: Math.round((h.n / build.partidas) * 100) })} · ${h.winrate.toFixed(0)} % WR`));
      lista.append(li);
    }
    s.append(lista);
    contenedor.append(s);
  }
}

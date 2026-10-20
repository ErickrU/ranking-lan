/**
 * Pestana "Campeones": catalogo de Data Dragon con busqueda y filtro por
 * clase; al elegir uno, la build agregada de la elite de la region activa
 * (objetos, runas, hechizos, rol, winrate) servida por /api/campeon.
 *
 * El catalogo es estatico y publico (sin cuota de Riot); la build es un
 * agregado del proxy construido con partidas reales del ladder.
 */

import { catalogoDataDragon, obtenerBuild, urlSplashCampeon, REGIONES, numero } from './api.js';
import { t } from './i18n.js';
import { retratoCampeon, renderBuild, renderExtraMensaje } from './ui.js';

const CLASES = ['Fighter', 'Tank', 'Mage', 'Assassin', 'Marksman', 'Support'];

const $ = (s) => document.querySelector(s);
const nodos = {
  buscar: $('#cat-buscar'),
  clases: $('#cat-clases'),
  nota: $('#cat-nota'),
  rejilla: $('#cat-rejilla'),
  vacio: $('#cat-vacio'),
  estado: $('#cat-estado'),
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

const estado = {
  catalogo: null,
  busqueda: '',
  clase: '',
  cargando: false,
  error: null,
};

const regionActual = () => {
  const v = nodos.selRegionGlobal?.value;
  return REGIONES.includes(v) ? v : 'la1';
};

const plegar = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/* ------------------------------------------------------------------ *
 * Catalogo
 * ------------------------------------------------------------------ */

async function cargarCatalogo() {
  estado.cargando = true;
  estado.error = null;
  render();
  try {
    estado.catalogo = await catalogoDataDragon();
  } catch (error) {
    estado.error = error.message;
  } finally {
    estado.cargando = false;
    render();
  }
}

function visibles() {
  if (!estado.catalogo) return [];
  const termino = plegar(estado.busqueda.trim());
  return estado.catalogo.campeones.filter((c) =>
    (!estado.clase || c.tags.includes(estado.clase)) &&
    (!termino || plegar(c.nombre).includes(termino) || plegar(c.idInterno).includes(termino)),
  );
}

function elemento(etiqueta, clase, texto) {
  const n = document.createElement(etiqueta);
  if (clase) n.className = clase;
  if (texto !== undefined) n.textContent = texto;
  return n;
}

function renderClases() {
  const fragmento = document.createDocumentFragment();
  const chip = (valor, texto) => {
    const b = elemento('button', 'cat-chip', texto);
    b.type = 'button';
    b.dataset.clase = valor;
    b.setAttribute('aria-pressed', String(estado.clase === valor));
    return b;
  };
  fragmento.append(chip('', t('cat.todos')));
  for (const c of CLASES) fragmento.append(chip(c, t(`clase.${c}`)));
  nodos.clases.replaceChildren(fragmento);
}

function render() {
  renderClases();

  if (estado.cargando) {
    nodos.estado.hidden = false;
    nodos.estado.textContent = t('cat.cargando');
    nodos.rejilla.replaceChildren();
    nodos.vacio.hidden = true;
    nodos.nota.textContent = '';
    return;
  }
  if (estado.error) {
    nodos.estado.hidden = false;
    nodos.estado.textContent = t('cat.error', { error: estado.error });
    nodos.rejilla.replaceChildren();
    nodos.vacio.hidden = true;
    return;
  }
  nodos.estado.hidden = true;

  // Sin catalogo todavia (p. ej. la pestana nunca se abrio y cambio el idioma).
  if (!estado.catalogo) {
    nodos.rejilla.replaceChildren();
    nodos.vacio.hidden = true;
    nodos.nota.textContent = '';
    return;
  }

  const lista = visibles();
  const { version, campeones } = estado.catalogo;
  nodos.nota.textContent = t('cat.nota', { n: numero(campeones.length), v: version });

  const fragmento = document.createDocumentFragment();
  for (const c of lista) {
    const tarjeta = elemento('button', 'cat-tarjeta');
    tarjeta.type = 'button';
    tarjeta.dataset.id = String(c.id);
    tarjeta.setAttribute('aria-label', `${c.nombre}, ${c.titulo}`);
    tarjeta.append(retratoCampeon(c.idInterno, version, 'retrato retrato--lg'));
    const texto = elemento('div', 'cat-tarjeta__texto');
    texto.append(elemento('strong', 'cat-tarjeta__nombre', c.nombre));
    texto.append(elemento('span', 'cat-tarjeta__titulo', c.titulo));
    tarjeta.append(texto);
    fragmento.append(tarjeta);
  }
  nodos.rejilla.replaceChildren(fragmento);
  nodos.vacio.hidden = lista.length > 0;
}

/* ------------------------------------------------------------------ *
 * Ficha de build
 * ------------------------------------------------------------------ */

let fichaActual = 0;

async function abrirBuild(campeonId) {
  const c = estado.catalogo?.campeonPorId.get(campeonId);
  if (!c) return;
  const mia = ++fichaActual;
  const region = regionActual();
  const d = nodos.dialogoNodos;

  d.titulo.textContent = c.nombre;
  d.sub.textContent = `${c.titulo} · ${c.tags.map((x) => t(`clase.${x}`)).join(' / ')} · ${t('build.titulo', { region: t(`region.${region}`).split(' · ')[0] })}`;
  d.datos.replaceChildren();
  d.insignias.replaceChildren();
  d.extra.replaceChildren();
  nodos.dialogo.dataset.campeon = c.idInterno;
  nodos.dialogo.style.setProperty('--splash', `url("${urlSplashCampeon(c.idInterno)}")`);
  renderExtraMensaje(d.extra, t('build.cargando'));

  if (typeof nodos.dialogo.showModal === 'function') nodos.dialogo.showModal();
  else nodos.dialogo.setAttribute('open', '');

  try {
    const resultado = await obtenerBuild({ campeonId, region, omitirRed: !navigator.onLine });
    if (mia !== fichaActual) return;
    d.extra.replaceChildren();
    renderBuild(d.extra, { ...resultado, campeon: c, catalogo: estado.catalogo });
  } catch (error) {
    if (mia !== fichaActual) return;
    d.extra.replaceChildren(elemento('p', 'dialogo__cargando', t('build.error', { error: error.message })));
  }
}

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */

export function iniciarCampeones() {
  let reloj;
  nodos.buscar.addEventListener('input', () => {
    clearTimeout(reloj);
    reloj = setTimeout(() => { estado.busqueda = nodos.buscar.value; render(); }, 150);
  });

  nodos.clases.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-clase]');
    if (!chip) return;
    estado.clase = chip.dataset.clase;
    render();
  });

  nodos.rejilla.addEventListener('click', (e) => {
    const tarjeta = e.target.closest('[data-id]');
    if (tarjeta) abrirBuild(Number(tarjeta.dataset.id));
  });

  // El dialogo es compartido: al cerrarse se limpia el fondo del campeon.
  nodos.dialogo.addEventListener('close', () => {
    delete nodos.dialogo.dataset.campeon;
    nodos.dialogo.style.removeProperty('--splash');
  });

  // La build depende de la region: si cambia con la ficha abierta, se recarga.
  addEventListener('regioncambiada', () => {
    const idInterno = nodos.dialogo.dataset.campeon;
    if (!idInterno || !nodos.dialogo.open) return;
    const c = estado.catalogo?.campeones.find((x) => x.idInterno === idInterno);
    if (c) abrirBuild(c.id);
  });

  // Carga perezosa: solo cuando la pestana se abre por primera vez.
  let cargado = false;

  // Idioma: el catalogo esta localizado. Si ya se habia cargado, se vuelve a
  // descargar en el nuevo idioma; si no, se re-etiquetan los chips y ya.
  addEventListener('idiomacambiado', () => {
    estado.catalogo = null;
    if (cargado) cargarCatalogo();
    else render();
  });

  addEventListener('restablecerfiltros', () => {
    estado.busqueda = '';
    estado.clase = '';
    nodos.buscar.value = '';
    render();
  });

  return () => {
    if (cargado) return;
    cargado = true;
    cargarCatalogo();
  };
}

/**
 * Panel de widgets · simulador del Widgets Board de Windows 11 para la PWA.
 *
 * En Microsoft Edge para Windows 11 los widgets de una PWA se declaran en el
 * manifest (miembro `widgets`), se pintan con una plantilla de Adaptive Card
 * (`ms_ac_template`) rellenada con los datos de `data`, y viven en el panel
 * de widgets del sistema. En macOS ese panel no existe, asi que este modulo
 * lo simula dentro de la pagina usando EXACTAMENTE los mismos archivos:
 *
 *   - lee el manifest y ofrece los widgets declarados en un selector
 *     ("+ Agregar widget"), igual que el selector de Windows;
 *   - descarga plantilla y datos, resuelve las expresiones ${...} y pinta la
 *     tarjeta con DOM (nunca innerHTML);
 *   - las acciones Action.Execute viajan al service worker con el mismo verbo
 *     que recibiria el evento `widgetclick` en Windows, y el service worker
 *     responde con los datos nuevos (WIDGET_ACTUALIZADO).
 *
 * Sin dependencias. El nivel superior no toca document/window/navigator para
 * que el modulo pueda importarse en Node (pruebas del resolvedor).
 */

/** Mensajes que cruzan entre la pagina y el service worker. */
export const MENSAJES = Object.freeze({
  DATOS: 'WIDGET_DATOS',
  ACCION: 'WIDGET_ACCION',
  ACTUALIZADO: 'WIDGET_ACTUALIZADO',
});

/** Textos por defecto (español). Cada app puede traducirlos con su propio t(). */
export const TEXTOS = Object.freeze({
  titulo: 'Widgets',
  panelAria: 'Panel de widgets',
  cerrar: 'Cerrar panel de widgets',
  agregar: '+ Agregar widget',
  agregarTitulo: 'Agregar widgets',
  agregarAccion: 'Agregar',
  yaAgregado: 'Ya está en el panel',
  quitar: 'Quitar widget',
  volver: 'Volver al panel',
  agregado: 'Widget agregado',
  quitado: 'Widget quitado',
  actualizado: 'Widget actualizado',
  vacio: 'No tienes widgets. Usa «+ Agregar widget» para añadir uno.',
  cargando: 'Cargando widget…',
  error: 'No se pudo cargar el widget.',
  sinSw: 'Sin service worker: las acciones del widget no están disponibles.',
  noSoportado: 'Elemento no soportado: {tipo}',
  simulacion: 'Simulación del Panel de widgets de Windows 11. En Microsoft Edge para Windows estos widgets se instalan en el panel del sistema.',
  masInfo: 'Más información',
});

const URL_DOCUMENTACION = 'https://learn.microsoft.com/es-es/microsoft-edge/progressive-web-apps/how-to/widgets';

/** Sustituye {nombre} por vars.nombre. */
function interpolar(texto, vars) {
  if (!vars) return texto;
  let salida = texto;
  for (const [nombre, valor] of Object.entries(vars)) {
    salida = salida.replaceAll(`{${nombre}}`, String(valor));
  }
  return salida;
}

const traducirPorDefecto = (clave, vars) => interpolar(TEXTOS[clave] ?? clave, vars);

/* ==========================================================================
   Resolvedor de expresiones ${...}
   --------------------------------------------------------------------------
   Subconjunto del lenguaje de plantillas de Adaptive Cards: literales, rutas
   (a.b[0].c) e if(condicion, a, b). Nunca lanza: lo que no entiende vale null.
   ========================================================================== */
const aTexto = (valor) => (valor === null || valor === undefined ? '' : String(valor));
const RE_RUTA = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;
const RE_NUMERO = /^-?\d+(?:\.\d+)?$/;
const OPERADORES = ['==', '!=', '<=', '>=', '<', '>'];
const avisadas = new Set();

function avisar(expresion) {
  if (avisadas.has(expresion)) return;
  avisadas.add(expresion);
  console.warn(`[widgets] expresión no soportada: \${${expresion}}`);
}

/** 'texto' | "texto" | numero | true | false | null */
function literal(expresion) {
  if (/^'[^']*'$/.test(expresion) || /^"[^"]*"$/.test(expresion)) {
    return { ok: true, valor: expresion.slice(1, -1) };
  }
  if (RE_NUMERO.test(expresion)) return { ok: true, valor: Number(expresion) };
  if (expresion === 'true') return { ok: true, valor: true };
  if (expresion === 'false') return { ok: true, valor: false };
  if (expresion === 'null') return { ok: true, valor: null };
  return { ok: false };
}

/** Recorre datos siguiendo a.b[0].c; cualquier eslabon ausente vale null. */
function resolverRuta(ruta, datos) {
  let actual = datos;
  for (const segmento of ruta.match(/[A-Za-z_$][\w$]*|\[\d+\]/g) ?? []) {
    if (actual === null || typeof actual !== 'object') return null;
    const clave = segmento.startsWith('[') ? Number(segmento.slice(1, -1)) : segmento;
    if (!Object.hasOwn(actual, clave)) return null;
    actual = actual[clave];
  }
  return actual === undefined ? null : actual;
}

/** Separa por comas de nivel superior, respetando comillas simples y dobles. */
function dividirArgumentos(texto) {
  const partes = [];
  let actual = '';
  let comilla = null;
  for (const caracter of texto) {
    if (comilla) {
      actual += caracter;
      if (caracter === comilla) comilla = null;
    } else if (caracter === '\'' || caracter === '"') {
      comilla = caracter;
      actual += caracter;
    } else if (caracter === ',') {
      partes.push(actual.trim());
      actual = '';
    } else {
      actual += caracter;
    }
  }
  partes.push(actual.trim());
  return partes;
}

function comparar(operador, a, b) {
  const iguales = a === b || String(a) === String(b);
  switch (operador) {
    case '==': return iguales;
    case '!=': return !iguales;
    case '<': return Number(a) < Number(b);
    case '<=': return Number(a) <= Number(b);
    case '>': return Number(a) > Number(b);
    case '>=': return Number(a) >= Number(b);
    default: return false;
  }
}

/** operando [op operando]; sin operador vale la veracidad JS del operando. */
function evaluarCondicion(condicion, datos) {
  let comilla = null;
  for (let i = 0; i < condicion.length; i++) {
    const caracter = condicion[i];
    if (comilla) {
      if (caracter === comilla) comilla = null;
      continue;
    }
    if (caracter === '\'' || caracter === '"') {
      comilla = caracter;
      continue;
    }
    const operador = OPERADORES.find((op) => condicion.startsWith(op, i));
    if (!operador) continue;
    const a = resolverExpresion(condicion.slice(0, i), datos);
    const b = resolverExpresion(condicion.slice(i + operador.length), datos);
    return comparar(operador, a, b);
  }
  return Boolean(resolverExpresion(condicion, datos));
}

/**
 * Evalua una expresion (sin el envoltorio ${}) sobre datos.
 * @returns {*} el valor crudo, o null si no existe o la expresion es invalida.
 */
export function resolverExpresion(expresion, datos) {
  try {
    if (typeof expresion !== 'string') return null;
    const texto = expresion.trim();
    if (texto === '') return null;

    const lit = literal(texto);
    if (lit.ok) return lit.valor;

    if (RE_RUTA.test(texto)) return resolverRuta(texto, datos);

    const condicional = /^if\((.*)\)$/s.exec(texto);
    if (condicional) {
      const argumentos = dividirArgumentos(condicional[1]);
      if (argumentos.length !== 3) {
        avisar(texto);
        return null;
      }
      return evaluarCondicion(argumentos[0], datos)
        ? resolverExpresion(argumentos[1], datos)
        : resolverExpresion(argumentos[2], datos);
    }

    avisar(texto);
    return null;
  } catch {
    return null;
  }
}

/** Sustituye cada ${...} del texto. Devuelve siempre string si recibe string. */
export function enlazarTexto(texto, datos) {
  if (typeof texto !== 'string') return texto;
  return texto.replace(/\$\{([^{}]*)\}/g, (_, expresion) => aTexto(resolverExpresion(expresion.trim(), datos)));
}

/** Clon profundo de la plantilla con todos sus strings enlazados. No muta el original. */
export function enlazarPlantilla(nodo, datos) {
  if (typeof nodo === 'string') return enlazarTexto(nodo, datos);
  if (Array.isArray(nodo)) return nodo.map((elemento) => enlazarPlantilla(elemento, datos));
  if (nodo && typeof nodo === 'object') {
    const copia = {};
    for (const [clave, valor] of Object.entries(nodo)) copia[clave] = enlazarPlantilla(valor, datos);
    return copia;
  }
  return nodo;
}

/* ==========================================================================
   Renderizador de Adaptive Cards (DOM, clases ac-*)
   ========================================================================== */
function crear(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

/** Solo http(s): una plantilla no puede colar javascript: ni data:. */
function urlSegura(url, base) {
  try {
    const resuelta = new URL(String(url), base);
    return resuelta.protocol === 'http:' || resuelta.protocol === 'https:' ? resuelta.href : null;
  } catch {
    return null;
  }
}

/** Copia un valor enumerado del esquema a data-* en minusculas. */
function enumerado(elemento, origen, propiedad, atributo) {
  if (typeof origen[propiedad] === 'string' && origen[propiedad] !== '') {
    elemento.dataset[atributo] = origen[propiedad].toLowerCase();
  }
}

/** spacing y separator los aceptan todos los elementos. */
function aplicarComunes(elemento, origen) {
  enumerado(elemento, origen, 'spacing', 'spacing');
  if (origen.separator === true) elemento.dataset.separator = 'true';
}

function desconocido(tipo, contexto) {
  const caja = crear('div', 'ac-desconocido', contexto.t('noSoportado', { tipo: aTexto(tipo) || '?' }));
  caja.setAttribute('role', 'note');
  return caja;
}

function anadirItems(contenedor, items, contexto) {
  for (const item of Array.isArray(items) ? items : []) {
    const nodo = renderizarElemento(item, contexto);
    if (nodo) contenedor.append(nodo);
  }
}

function renderizarTexto(origen) {
  const parrafo = crear('p', 'ac-texto', aTexto(origen.text));
  enumerado(parrafo, origen, 'size', 'size');
  enumerado(parrafo, origen, 'weight', 'weight');
  enumerado(parrafo, origen, 'color', 'color');
  enumerado(parrafo, origen, 'horizontalAlignment', 'align');
  if (origen.isSubtle === true) parrafo.dataset.subtle = 'true';
  if (origen.wrap === false) parrafo.dataset.wrap = 'false';
  aplicarComunes(parrafo, origen);
  return parrafo;
}

function renderizarContenedor(origen, contexto) {
  const caja = crear('div', 'ac-contenedor');
  enumerado(caja, origen, 'style', 'style');
  aplicarComunes(caja, origen);
  anadirItems(caja, origen.items, contexto);
  return caja;
}

function renderizarColumna(origen, contexto) {
  const columna = crear('div', 'ac-columna');
  if (!origen || typeof origen !== 'object') {
    columna.dataset.ancho = 'stretch';
    return columna;
  }
  const ancho = origen.width;
  if (ancho === 'auto') {
    columna.dataset.ancho = 'auto';
  } else if (ancho === undefined || ancho === 'stretch') {
    columna.dataset.ancho = 'stretch';
  } else if (typeof ancho === 'number' || RE_NUMERO.test(String(ancho))) {
    columna.dataset.ancho = 'peso';
    columna.style.flexGrow = String(Number(ancho));
  } else if (/^\d+(?:\.\d+)?px$/.test(String(ancho))) {
    columna.dataset.ancho = 'px';
    columna.style.flexBasis = String(ancho);
  } else {
    columna.dataset.ancho = 'stretch';
  }
  enumerado(columna, origen, 'verticalContentAlignment', 'valign');
  aplicarComunes(columna, origen);
  anadirItems(columna, origen.items, contexto);
  return columna;
}

function renderizarColumnas(origen, contexto) {
  const conjunto = crear('div', 'ac-columnas');
  aplicarComunes(conjunto, origen);
  for (const columna of Array.isArray(origen.columns) ? origen.columns : []) {
    conjunto.append(renderizarColumna(columna, contexto));
  }
  return conjunto;
}

function renderizarImagen(origen, contexto) {
  const src = urlSegura(origen.url, contexto.base);
  if (!src) return null; // sin URL valida el elemento se omite
  const imagen = crear('img', 'ac-imagen');
  imagen.src = src;
  imagen.alt = aTexto(origen.altText);
  enumerado(imagen, origen, 'size', 'size');
  if (origen.style === 'person') imagen.dataset.style = 'person';
  enumerado(imagen, origen, 'horizontalAlignment', 'align');
  aplicarComunes(imagen, origen);
  return imagen;
}

function renderizarHechos(origen) {
  const lista = crear('dl', 'ac-hechos');
  aplicarComunes(lista, origen);
  for (const hecho of Array.isArray(origen.facts) ? origen.facts : []) {
    const fila = crear('div', 'ac-hecho');
    fila.append(crear('dt', null, aTexto(hecho?.title)), crear('dd', null, aTexto(hecho?.value)));
    lista.append(fila);
  }
  return lista;
}

/** Un elemento del body. Nunca lanza: un elemento roto se pinta como desconocido. */
function renderizarElemento(origen, contexto) {
  try {
    if (!origen || typeof origen !== 'object') return desconocido(undefined, contexto);
    switch (origen.type) {
      case 'TextBlock': return renderizarTexto(origen, contexto);
      case 'Container': return renderizarContenedor(origen, contexto);
      case 'ColumnSet': return renderizarColumnas(origen, contexto);
      case 'Image': return renderizarImagen(origen, contexto);
      case 'FactSet': return renderizarHechos(origen, contexto);
      default: return desconocido(origen.type, contexto);
    }
  } catch (error) {
    console.warn('[widgets] elemento ilegible', error);
    return desconocido(origen?.type, contexto);
  }
}

function botonDeshabilitado(titulo, motivo) {
  const boton = crear('button', 'ac-accion', aTexto(titulo) || motivo);
  boton.type = 'button';
  boton.disabled = true;
  boton.title = motivo;
  return boton;
}

function renderizarAccion(origen, contexto) {
  try {
    const tipo = origen?.type;
    if (tipo === 'Action.Execute') {
      const verb = aTexto(origen.verb);
      const boton = crear('button', 'ac-accion', aTexto(origen.title) || verb);
      boton.type = 'button';
      boton.dataset.verb = verb;
      enumerado(boton, origen, 'style', 'style');
      boton.addEventListener('click', () => contexto.alEjecutar?.(verb, origen));
      return boton;
    }
    if (tipo === 'Action.OpenUrl') {
      const href = urlSegura(origen.url, contexto.base);
      if (!href) return botonDeshabilitado(origen.title, contexto.t('noSoportado', { tipo }));
      const enlace = crear('a', 'ac-accion ac-accion--enlace', aTexto(origen.title) || href);
      enlace.href = href;
      enlace.target = '_blank';
      enlace.rel = 'noopener noreferrer';
      enumerado(enlace, origen, 'style', 'style');
      return enlace;
    }
    return botonDeshabilitado(origen?.title, contexto.t('noSoportado', { tipo: aTexto(tipo) || '?' }));
  } catch (error) {
    console.warn('[widgets] acción ilegible', error);
    return botonDeshabilitado(undefined, contexto.t('noSoportado', { tipo: aTexto(origen?.type) || '?' }));
  }
}

/**
 * Pinta una Adaptive Card.
 * @param {object} plantilla  la tarjeta (con ${...} si se pasan datos, o ya enlazada)
 * @param {object|null} datos  si se pasan, la plantilla se enlaza primero
 * @param {{ alEjecutar?: Function, base?: string, t?: Function }} [opciones]
 * @returns {HTMLElement} div.ac-tarjeta
 */
export function renderizarTarjeta(plantilla, datos, opciones = {}) {
  const contexto = {
    alEjecutar: opciones.alEjecutar,
    base: opciones.base ?? (typeof location === 'undefined' ? 'http://localhost/' : location.href),
    t: opciones.t ?? traducirPorDefecto,
  };
  const tarjeta = datos ? enlazarPlantilla(plantilla, datos) : plantilla;
  const raiz = crear('div', 'ac-tarjeta');
  const cuerpo = crear('div', 'ac-cuerpo');
  anadirItems(cuerpo, tarjeta?.body, contexto);
  raiz.append(cuerpo);

  const acciones = Array.isArray(tarjeta?.actions) ? tarjeta.actions : [];
  if (acciones.length > 0) {
    const contenedor = crear('div', 'ac-acciones');
    for (const accion of acciones) contenedor.append(renderizarAccion(accion, contexto));
    raiz.append(contenedor);
  }
  return raiz;
}

/* ==========================================================================
   Pagina <-> service worker
   ========================================================================== */
const haySw = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

/** El service worker activo, o null si no hay o tarda mas de limiteMs. */
async function trabajadorActivo(limiteMs = 3000) {
  if (!haySw()) return null;
  try {
    const vencimiento = new Promise((resolver) => setTimeout(() => resolver(null), limiteMs));
    const registro = await Promise.race([navigator.serviceWorker.ready, vencimiento]);
    return registro?.active ?? null;
  } catch {
    return null;
  }
}

/** La pagina publica los datos mas recientes de un widget (silencioso sin SW). */
export function enviarDatosWidget(tag, datos) {
  if (!haySw()) return;
  navigator.serviceWorker.ready
    .then((registro) => registro.active?.postMessage({ tipo: MENSAJES.DATOS, tag, datos }))
    .catch(() => {});
}

/** Suscribe callback(datos) a los WIDGET_ACTUALIZADO de un tag. Devuelve la baja. */
export function alActualizarWidget(tag, callback) {
  if (!haySw()) return () => {};
  const oyente = (evento) => {
    const mensaje = evento.data;
    if (mensaje?.tipo === MENSAJES.ACTUALIZADO && mensaje.tag === tag) callback(mensaje.datos);
  };
  navigator.serviceWorker.addEventListener('message', oyente);
  return () => navigator.serviceWorker.removeEventListener('message', oyente);
}

/* ==========================================================================
   Panel (simulador del Widgets Board)
   ========================================================================== */

/**
 * Crea el <dialog> del panel, lo cuelga de <body> y lo conecta al boton.
 * @param {object} opciones
 * @param {HTMLElement} opciones.boton        control de la barra de titulo que abre el panel
 * @param {Function} [opciones.anunciar]       region viva de la app (texto)
 * @param {Function} [opciones.t]              traductor (clave, vars)
 * @param {string} [opciones.claveAlmacen]     clave de localStorage con los tags instalados
 * @param {string} [opciones.urlManifest]      por defecto, el <link rel="manifest">
 * @returns {{ abrir: Function, cerrar: Function, retraducir: Function, destruir: Function, dialogo: HTMLDialogElement }}
 */
export function crearPanelWidgets({
  boton,
  anunciar = () => {},
  t = traducirPorDefecto,
  claveAlmacen = 'pwa:widgets-instalados',
  urlManifest,
} = {}) {
  const urlBase = urlManifest
    ?? document.querySelector('link[rel="manifest"]')?.href
    ?? new URL('./manifest.webmanifest', location.href).href;
  const resolver = (ruta) => new URL(ruta, urlBase).href;

  /* ---- Estado ---------------------------------------------------------- */
  let promesaManifest = null;      // fetch del manifest, una sola vez
  let widgets = [];                // definiciones del manifest
  let iconoManifest = null;        // icons[0] del manifest, respaldo del icono de tarjeta
  let focoAnterior = null;
  const plantillas = new Map();    // url -> promesa del JSON de la plantilla
  const ultimosDatos = new Map();  // tag -> ultimos datos recibidos
  const pendientes = new Map();    // tag -> { promesa, resolver } esperando WIDGET_ACTUALIZADO
  const tarjetas = new Map();      // tag -> { widget, articulo, cuerpo }
  const temporizadores = new Set();

  const leerInstalados = () => {
    try {
      const lista = JSON.parse(localStorage.getItem(claveAlmacen) ?? '[]');
      return Array.isArray(lista) ? lista.filter((tag) => typeof tag === 'string') : [];
    } catch {
      return [];
    }
  };
  const guardarInstalados = (lista) => {
    try { localStorage.setItem(claveAlmacen, JSON.stringify(lista)); } catch { /* modo privado */ }
  };
  const nombreDe = (widget) => widget.name ?? widget.tag;

  /* ---- DOM (estructura fija del panel) --------------------------------- */
  const dialogo = crear('dialog', 'pw-panel');
  dialogo.id = 'panel-widgets';
  dialogo.setAttribute('aria-labelledby', 'pw-titulo');

  const cabecera = crear('div', 'pw-cabecera');
  const icono = crear('img', 'pw-icono');
  icono.alt = '';
  icono.width = 28;
  icono.height = 28;
  icono.hidden = true;
  const titulo = crear('h2', 'pw-titulo');
  titulo.id = 'pw-titulo';
  const botonCerrar = crear('button', 'pw-cerrar', '×');
  botonCerrar.type = 'button';
  cabecera.append(icono, titulo, botonCerrar);

  const vista = crear('div', 'pw-vista');
  vista.dataset.vista = 'panel';

  const tablero = crear('section', 'pw-tablero');
  const herramientas = crear('div', 'pw-herramientas');
  const botonAgregar = crear('button', 'pw-agregar-boton');
  botonAgregar.type = 'button';
  herramientas.append(botonAgregar);
  const rejilla = crear('div', 'pw-rejilla');
  const vacio = crear('p', 'pw-vacio');
  vacio.hidden = true;
  tablero.append(herramientas, rejilla, vacio);

  const agregar = crear('section', 'pw-agregar');
  agregar.hidden = true;
  agregar.setAttribute('aria-labelledby', 'pw-agregar-titulo');
  const tituloAgregar = crear('h3', 'pw-agregar__titulo');
  tituloAgregar.id = 'pw-agregar-titulo';
  const opciones = crear('ul', 'pw-opciones');
  const botonVolver = crear('button', 'pw-volver');
  botonVolver.type = 'button';
  agregar.append(tituloAgregar, opciones, botonVolver);

  vista.append(tablero, agregar);

  const aviso = crear('p', 'pw-aviso');
  aviso.setAttribute('role', 'note');
  const avisoTexto = crear('span', 'pw-aviso__texto');
  const avisoEnlace = crear('a', 'pw-aviso__enlace');
  avisoEnlace.href = URL_DOCUMENTACION;
  avisoEnlace.target = '_blank';
  avisoEnlace.rel = 'noopener noreferrer';
  aviso.append(avisoTexto, ' ', avisoEnlace);

  dialogo.append(cabecera, vista, aviso);
  document.body.append(dialogo);

  /* ---- Textos ---------------------------------------------------------- */
  function retraducir() {
    titulo.textContent = t('titulo');
    botonCerrar.setAttribute('aria-label', t('cerrar'));
    botonCerrar.title = t('cerrar');
    tablero.setAttribute('aria-label', t('panelAria'));
    botonAgregar.textContent = t('agregar');
    tituloAgregar.textContent = t('agregarTitulo');
    botonVolver.textContent = t('volver');
    vacio.textContent = t('vacio');
    avisoTexto.textContent = t('simulacion');
    avisoEnlace.textContent = t('masInfo');
    for (const { widget, articulo, cuerpo } of tarjetas.values()) {
      articulo.querySelector('.pw-quitar')?.setAttribute('aria-label', `${t('quitar')} ${nombreDe(widget)}`);
      const estado = cuerpo.querySelector('.pw-estado');
      if (estado) estado.textContent = estado.classList.contains('pw-estado--error') ? t('error') : t('cargando');
    }
    if (!agregar.hidden) pintarOpciones();
  }

  /* ---- Manifest y plantillas ------------------------------------------- */
  async function cargarWidgets() {
    promesaManifest ??= fetch(urlBase, { headers: { Accept: 'application/manifest+json, application/json' } })
      .then((respuesta) => {
        if (!respuesta.ok) throw new Error(`manifest -> ${respuesta.status}`);
        return respuesta.json();
      })
      .catch((error) => {
        promesaManifest = null; // se reintenta la proxima vez
        throw error;
      });
    const manifest = await promesaManifest;
    widgets = Array.isArray(manifest.widgets)
      ? manifest.widgets.filter((widget) => widget && typeof widget.tag === 'string')
      : [];
    iconoManifest = manifest.icons?.[0]?.src ? resolver(manifest.icons[0].src) : null;
    if (iconoManifest) {
      icono.src = iconoManifest;
      icono.hidden = false;
    }
    return widgets;
  }

  function obtenerPlantilla(url) {
    if (!plantillas.has(url)) {
      plantillas.set(url, fetch(url, { headers: { Accept: 'application/json' } })
        .then((respuesta) => {
          if (!respuesta.ok) throw new Error(`plantilla -> ${respuesta.status}`);
          return respuesta.json();
        })
        .catch((error) => {
          plantillas.delete(url);
          throw error;
        }));
    }
    return plantillas.get(url);
  }

  /* ---- Datos: service worker primero, JSON estatico de respaldo -------- */

  /** Una sola promesa pendiente por tag; peticiones concurrentes la comparten. */
  function esperarActualizacion(tag, limiteMs = 4000) {
    const existente = pendientes.get(tag);
    if (existente) return existente.promesa;
    let resolverPromesa;
    const promesa = new Promise((resolve) => { resolverPromesa = resolve; });
    const temporizador = setTimeout(() => {
      pendientes.delete(tag);
      resolverPromesa(null);
    }, limiteMs);
    pendientes.set(tag, {
      promesa,
      resolver(datos) {
        clearTimeout(temporizador);
        pendientes.delete(tag);
        resolverPromesa(datos);
      },
    });
    return promesa;
  }

  async function pedirDatos(widget) {
    let datos = null;
    const trabajador = await trabajadorActivo(3000);
    if (trabajador) {
      const respuesta = esperarActualizacion(widget.tag, 4000);
      trabajador.postMessage({ tipo: MENSAJES.DATOS, tag: widget.tag });
      datos = await respuesta;
    }
    if (!datos && widget.data) {
      const respuesta = await fetch(resolver(widget.data), { headers: { Accept: 'application/json' } });
      if (!respuesta.ok) throw new Error(`datos -> ${respuesta.status}`);
      datos = await respuesta.json();
    }
    datos = datos && typeof datos === 'object' ? datos : {};
    ultimosDatos.set(widget.tag, datos);
    return datos;
  }

  const alMensaje = (evento) => {
    const mensaje = evento.data;
    if (!mensaje || mensaje.tipo !== MENSAJES.ACTUALIZADO || typeof mensaje.tag !== 'string') return;
    const datos = mensaje.datos && typeof mensaje.datos === 'object' ? mensaje.datos : {};
    ultimosDatos.set(mensaje.tag, datos);
    const pendiente = pendientes.get(mensaje.tag);
    if (pendiente) {
      pendiente.resolver(datos);
      return;
    }
    // Nadie esperaba (p. ej. actualizacion espontanea del SW): repintamos si esta montada.
    const tarjeta = tarjetas.get(mensaje.tag);
    if (tarjeta) renderizarCuerpo(tarjeta, datos).catch(() => {});
  };
  if (haySw()) navigator.serviceWorker.addEventListener('message', alMensaje);

  /* ---- Tarjetas -------------------------------------------------------- */

  /** Reemplaza el cuerpo conservando el foco en el boton del mismo verbo. */
  async function renderizarCuerpo(tarjeta, datos) {
    const { widget, cuerpo } = tarjeta;
    const plantilla = await obtenerPlantilla(resolver(widget.ms_ac_template));
    const activo = document.activeElement;
    const verbConFoco = cuerpo.contains(activo) ? activo.dataset?.verb : undefined;
    cuerpo.replaceChildren(renderizarTarjeta(plantilla, datos, {
      alEjecutar: (verb) => ejecutarAccion(widget.tag, verb),
      t,
    }));
    if (verbConFoco !== undefined) {
      cuerpo.querySelector(`.ac-accion[data-verb="${CSS.escape(verbConFoco)}"]`)?.focus();
    }
  }

  async function cargarTarjeta(tarjeta) {
    try {
      const datos = await pedirDatos(tarjeta.widget);
      if (tarjetas.get(tarjeta.widget.tag) !== tarjeta) return; // se quito mientras cargaba
      await renderizarCuerpo(tarjeta, datos);
    } catch (error) {
      console.warn('[widgets] no se pudo montar', tarjeta.widget.tag, error);
      tarjeta.cuerpo.replaceChildren(crear('p', 'pw-estado pw-estado--error', t('error')));
    }
  }

  function montarTarjeta(widget) {
    const articulo = crear('article', 'pw-tarjeta');
    articulo.setAttribute('role', 'group');
    articulo.setAttribute('aria-label', nombreDe(widget));
    articulo.dataset.tag = widget.tag;
    articulo.tabIndex = -1;

    const cabeceraTarjeta = crear('header', 'pw-tarjeta__cabecera');
    const iconoTarjeta = crear('img', 'pw-tarjeta__icono');
    iconoTarjeta.alt = '';
    iconoTarjeta.width = 20;
    iconoTarjeta.height = 20;
    const srcIcono = widget.icons?.[0]?.src ? resolver(widget.icons[0].src) : iconoManifest;
    if (srcIcono) iconoTarjeta.src = srcIcono;
    else iconoTarjeta.hidden = true;
    const nombre = crear('span', 'pw-tarjeta__nombre', nombreDe(widget));
    const quitar = crear('button', 'pw-quitar', '×');
    quitar.type = 'button';
    quitar.setAttribute('aria-label', `${t('quitar')} ${nombreDe(widget)}`);
    quitar.addEventListener('click', () => quitarWidget(widget.tag));
    cabeceraTarjeta.append(iconoTarjeta, nombre, quitar);

    const cuerpo = crear('div', 'pw-tarjeta__cuerpo');
    cuerpo.append(crear('p', 'pw-estado', t('cargando')));
    articulo.append(cabeceraTarjeta, cuerpo);
    rejilla.append(articulo);

    const tarjeta = { widget, articulo, cuerpo };
    tarjetas.set(widget.tag, tarjeta);
    actualizarVacio();
    cargarTarjeta(tarjeta);
    return tarjeta;
  }

  /** Refresco silencioso: conserva lo pintado hasta que llegan datos nuevos. */
  async function refrescar(tarjeta) {
    if (!tarjeta) return;
    try {
      const datos = await pedirDatos(tarjeta.widget);
      if (tarjetas.get(tarjeta.widget.tag) === tarjeta) await renderizarCuerpo(tarjeta, datos);
    } catch (error) {
      console.warn('[widgets] no se pudo refrescar', tarjeta.widget.tag, error);
    }
  }

  async function ejecutarAccion(tag, verb) {
    const tarjeta = tarjetas.get(tag);
    const trabajador = await trabajadorActivo(3000);
    if (!trabajador) {
      anunciar(t('sinSw'));
      return;
    }
    tarjeta?.cuerpo.setAttribute('aria-busy', 'true');
    try {
      const respuesta = esperarActualizacion(tag, 4000);
      trabajador.postMessage({ tipo: MENSAJES.ACCION, tag, verb });
      const datos = await respuesta;
      if (datos && tarjeta && tarjetas.get(tag) === tarjeta) {
        await renderizarCuerpo(tarjeta, datos);
        anunciar(t('actualizado'));
      }
    } catch (error) {
      console.warn('[widgets] acción fallida', tag, verb, error);
    } finally {
      tarjeta?.cuerpo.removeAttribute('aria-busy');
    }
  }

  function actualizarVacio() {
    vacio.hidden = tarjetas.size > 0;
  }

  function limpiarTemporizadores() {
    for (const id of temporizadores) clearInterval(id);
    temporizadores.clear();
  }

  /** Con el panel abierto, refresca cada widget segun su `update` (minimo 15 s). */
  function programarRefrescos() {
    limpiarTemporizadores();
    if (!dialogo.open) return;
    for (const { widget } of tarjetas.values()) {
      if (typeof widget.update !== 'number' || !(widget.update > 0)) continue;
      const ms = Math.max(widget.update, 15) * 1000;
      temporizadores.add(setInterval(() => refrescar(tarjetas.get(widget.tag)), ms));
    }
  }

  /* ---- Agregar / quitar ------------------------------------------------ */
  function mostrarVista(nombre) {
    vista.dataset.vista = nombre;
    tablero.hidden = nombre !== 'panel';
    agregar.hidden = nombre !== 'agregar';
  }

  function pintarOpciones() {
    const instalados = new Set(leerInstalados());
    opciones.replaceChildren();
    for (const widget of widgets) {
      const opcion = crear('li', 'pw-opcion');
      const captura = widget.screenshots?.[0];
      if (captura?.src) {
        const imagen = crear('img', 'pw-opcion__captura');
        imagen.src = resolver(captura.src);
        imagen.alt = captura.label ?? '';
        imagen.loading = 'lazy';
        imagen.addEventListener('error', () => {
          imagen.hidden = true;
          opcion.dataset.sinCaptura = 'si';
        });
        opcion.append(imagen);
      } else {
        opcion.dataset.sinCaptura = 'si';
      }
      const texto = crear('div', 'pw-opcion__texto');
      texto.append(
        crear('strong', 'pw-opcion__nombre', nombreDe(widget)),
        crear('p', 'pw-opcion__descripcion', widget.description ?? ''),
      );
      const botonOpcion = crear('button', 'pw-opcion__agregar');
      botonOpcion.type = 'button';
      if (instalados.has(widget.tag)) {
        botonOpcion.disabled = true;
        botonOpcion.textContent = t('yaAgregado');
      } else {
        botonOpcion.textContent = t('agregarAccion');
        botonOpcion.setAttribute('aria-label', `${t('agregarAccion')} ${nombreDe(widget)}`);
        botonOpcion.addEventListener('click', () => agregarWidget(widget));
      }
      opcion.append(texto, botonOpcion);
      opciones.append(opcion);
    }
  }

  async function abrirSelector() {
    try { await cargarWidgets(); } catch (error) { console.warn('[widgets] manifest', error); }
    pintarOpciones();
    mostrarVista('agregar');
    const primero = opciones.querySelector('.pw-opcion__agregar:not(:disabled)');
    (primero ?? botonVolver).focus();
  }

  function agregarWidget(widget) {
    const instalados = leerInstalados();
    if (!instalados.includes(widget.tag)) guardarInstalados([...instalados, widget.tag]);
    mostrarVista('panel');
    const tarjeta = tarjetas.get(widget.tag) ?? montarTarjeta(widget);
    anunciar(t('agregado'));
    tarjeta.articulo.focus();
    programarRefrescos();
  }

  function quitarWidget(tag) {
    guardarInstalados(leerInstalados().filter((instalado) => instalado !== tag));
    const tarjeta = tarjetas.get(tag);
    if (tarjeta) {
      tarjeta.articulo.remove();
      tarjetas.delete(tag);
    }
    actualizarVacio();
    anunciar(t('quitado'));
    botonAgregar.focus();
    programarRefrescos();
  }

  /* ---- Abrir / cerrar -------------------------------------------------- */
  async function abrir() {
    if (dialogo.open) return;
    focoAnterior = document.activeElement;
    if (typeof dialogo.showModal === 'function') dialogo.showModal();
    else dialogo.setAttribute('open', '');
    mostrarVista('panel');
    botonCerrar.focus();

    try { await cargarWidgets(); } catch (error) { console.warn('[widgets] manifest', error); }
    if (!dialogo.open) return; // se cerro mientras cargaba

    const porTag = new Map(widgets.map((widget) => [widget.tag, widget]));
    for (const tag of leerInstalados()) {
      const widget = porTag.get(tag); // tags que ya no existen en el manifest se ignoran
      if (!widget) continue;
      if (tarjetas.has(tag)) refrescar(tarjetas.get(tag));
      else montarTarjeta(widget);
    }
    actualizarVacio();
    programarRefrescos();
  }

  function cerrar() {
    if (dialogo.open) dialogo.close();
  }

  dialogo.addEventListener('close', () => {
    limpiarTemporizadores();
    mostrarVista('panel');
    const destino = focoAnterior?.isConnected ? focoAnterior : boton;
    focoAnterior = null;
    if (typeof destino?.focus === 'function') destino.focus();
  });
  // Clic en el fondo (fuera de la hoja) cierra; Escape lo hace el propio <dialog>.
  dialogo.addEventListener('click', (evento) => {
    if (evento.target === dialogo) cerrar();
  });
  botonCerrar.addEventListener('click', cerrar);
  botonAgregar.addEventListener('click', abrirSelector);
  botonVolver.addEventListener('click', () => {
    mostrarVista('panel');
    botonAgregar.focus();
  });
  boton?.addEventListener('click', abrir);

  function destruir() {
    limpiarTemporizadores();
    boton?.removeEventListener('click', abrir);
    if (haySw()) navigator.serviceWorker.removeEventListener('message', alMensaje);
    cerrar();
    dialogo.remove();
  }

  retraducir();
  return { abrir, cerrar, retraducir, destruir, dialogo };
}

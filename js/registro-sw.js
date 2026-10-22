/**
 * Registro del service worker, aviso de nueva version y prompt de instalacion.
 * Modulo independiente de la logica de la app; solo comparte i18n.
 */
import { t } from './i18n.js';
import { crearPanelWidgets } from './widgets.js';

const estadoSw = document.getElementById('estado-sw');
const estadoPwa = document.getElementById('estado-pwa');
const toast = document.getElementById('toast-actualizacion');
const btnRecargar = document.getElementById('btn-recargar');
const metaTema = document.querySelector('meta[name="theme-color"]');

/* Los seis controles de la barra de titulo */
const btnInstalar = document.getElementById('btn-instalar');
const btnCompartir = document.getElementById('control-compartir');
const btnTema = document.getElementById('control-tema');
const btnRestablecer = document.getElementById('control-restablecer');
const btnAyuda = document.getElementById('control-ayuda');
const btnWidgets = document.getElementById('control-widgets');
const dialogoAyuda = document.getElementById('dialogo-ayuda');
const btnCerrarAyuda = document.getElementById('cerrar-ayuda');

/* El ultimo estado se recuerda para re-traducirlo si cambia el idioma. */
let ultimoEstado = null;

const informar = (clave, vars) => {
  ultimoEstado = { clave, vars };
  if (estadoSw) estadoSw.textContent = `Service worker: ${t(clave, vars)}`;
};

/** Region viva para anunciar el resultado de los controles a lectores de pantalla. */
const anunciar = (texto) => {
  if (!estadoPwa) return;
  // Vaciar y volver a escribir fuerza el anuncio aunque el texto se repita.
  estadoPwa.textContent = '';
  requestAnimationFrame(() => { estadoPwa.textContent = texto; });
};

addEventListener('idiomacambiado', () => {
  if (ultimoEstado) informar(ultimoEstado.clave, ultimoEstado.vars);
});

/* ================================================================
   1. Service worker
   ================================================================ */
if (!('serviceWorker' in navigator)) {
  informar('sw.noSoportado');
} else {
  // Solo recargamos si NOSOTROS pedimos activar la version nueva. En la primera
  // visita clients.claim() tambien dispara controllerchange y recargar ahi seria
  // un parpadeo gratuito para el usuario.
  let saltoSolicitado = false;
  let recargando = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!saltoSolicitado || recargando) return;
    recargando = true;
    location.reload();
  });

  /**
   * Un SW "esperando" solo es una actualizacion real si ya habia otro
   * controlando la pagina. En la primera instalacion no hay nada que avisar.
   */
  function revisarEspera(registro) {
    if (!registro.waiting || !navigator.serviceWorker.controller) return;
    informar('sw.nuevaVersion');
    if (!toast || !btnRecargar) return;

    toast.hidden = false;
    btnRecargar.onclick = () => {
      btnRecargar.disabled = true;
      saltoSolicitado = true;
      // El SW responde a este mensaje con skipWaiting().
      registro.waiting.postMessage({ tipo: 'SALTAR_ESPERA' });
    };
  }

  window.addEventListener('load', async () => {
    try {
      const registro = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      informar(registro.active ? 'sw.activo' : 'sw.instalando');

      // ¿Quedo una version esperando de una visita anterior?
      revisarEspera(registro);

      registro.addEventListener('updatefound', () => {
        const nuevo = registro.installing;
        if (!nuevo) return;
        informar('sw.descargando');

        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed') revisarEspera(registro);
          if (nuevo.state === 'activated' && !registro.waiting) {
            informar('sw.activo');
          }
        });
      });

      // Busca actualizaciones al volver a la pestana (max. una vez por hora).
      let ultimaRevision = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - ultimaRevision > 3600_000) {
          ultimaRevision = Date.now();
          registro.update().catch(() => {});
        }
      });
    } catch (error) {
      informar('sw.error', { error: error.message });
    }
  });
}

/* ================================================================
   2. Instalacion (beforeinstallprompt)
   ----------------------------------------------------------------
   El boton es permanente (forma parte de la barra de titulo). Sin el
   evento del navegador, al pulsarlo se explica como instalar a mano;
   con la app ya instalada, se marca como tal y no hace nada.
   ================================================================ */
let eventoInstalacion = null;

const yaInstalada = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: window-controls-overlay)').matches ||
  navigator.standalone === true;

function marcarInstalada() {
  if (!btnInstalar || !yaInstalada()) return;
  btnInstalar.dataset.instalada = 'si';
  btnInstalar.setAttribute('aria-pressed', 'true');
  btnInstalar.querySelector('span').textContent = t('control.instalada');
  btnInstalar.setAttribute('aria-label', t('control.instalada'));
  btnInstalar.title = t('control.instalada');
}

window.addEventListener('beforeinstallprompt', (evento) => {
  // Evitamos el mini-infobar para usar nuestro propio boton.
  evento.preventDefault();
  eventoInstalacion = evento;
  anunciar(t('pwa.listaParaInstalar'));
});

btnInstalar?.addEventListener('click', async () => {
  if (yaInstalada()) {
    anunciar(t('pwa.yaInstalada'));
    return;
  }
  if (!eventoInstalacion) {
    anunciar(t('pwa.instalarManual'));
    return;
  }
  btnInstalar.disabled = true;
  try {
    // prompt() exige un gesto de usuario real y lanza NotAllowedError si no lo hay.
    await eventoInstalacion.prompt();
    const { outcome } = await eventoInstalacion.userChoice;
    anunciar(outcome === 'accepted' ? t('pwa.instalacionAceptada') : t('pwa.instalacionCancelada'));
  } catch {
    anunciar(t('pwa.instalarManual'));
  } finally {
    // El evento solo se puede usar una vez.
    eventoInstalacion = null;
    btnInstalar.disabled = false;
  }
});

window.addEventListener('appinstalled', () => {
  eventoInstalacion = null;
  marcarInstalada();
  anunciar(t('pwa.instalada'));
});

/* ================================================================
   3. Compartir
   ----------------------------------------------------------------
   Web Share si existe; si no (o si falla por algo que no sea que el
   usuario cerro el dialogo), se copia el enlace al portapapeles.
   ================================================================ */
async function copiarEnlace() {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(location.href);
    return;
  }
  // Respaldo para contextos sin Clipboard API.
  const campo = document.createElement('textarea');
  campo.value = location.href;
  campo.setAttribute('readonly', '');
  campo.className = 'visualmente-oculto';
  document.body.append(campo);
  campo.select();
  const copiado = document.execCommand('copy');
  campo.remove();
  if (!copiado) throw new Error('copy');
}

btnCompartir?.addEventListener('click', async () => {
  try {
    if (navigator.share) {
      await navigator.share({ title: document.title, text: t('pwa.textoCompartir'), url: location.href });
      anunciar(t('pwa.compartida'));
    } else {
      await copiarEnlace();
      anunciar(t('pwa.enlaceCopiado'));
    }
  } catch (error) {
    if (error.name === 'AbortError') return; // el usuario cerro el dialogo del sistema
    try {
      await copiarEnlace();
      anunciar(t('pwa.enlaceCopiado'));
    } catch {
      anunciar(t('pwa.noCompartir'));
    }
  }
});

/* ================================================================
   4. Tema claro / oscuro
   ================================================================ */
const CLAVE_TEMA = 'ranking-lan:tema';
const COLOR_TEMA = { oscuro: '#0a0f1c', claro: '#f2f6fb' }; // = fondo de cada tema

function aplicarTema(tema, guardar = true) {
  document.documentElement.dataset.tema = tema;
  if (metaTema) metaTema.content = COLOR_TEMA[tema];
  if (btnTema) {
    btnTema.setAttribute('aria-pressed', String(tema === 'claro'));
    const etiqueta = tema === 'claro' ? t('control.temaOscuro') : t('control.temaClaro');
    btnTema.setAttribute('aria-label', etiqueta);
    btnTema.title = etiqueta;
  }
  if (guardar) {
    try { localStorage.setItem(CLAVE_TEMA, tema); } catch { /* modo privado */ }
  }
}

let temaGuardado = null;
try { temaGuardado = localStorage.getItem(CLAVE_TEMA); } catch { /* modo privado */ }
aplicarTema(temaGuardado === 'claro' ? 'claro' : 'oscuro', false);

btnTema?.addEventListener('click', () => {
  const tema = document.documentElement.dataset.tema === 'claro' ? 'oscuro' : 'claro';
  aplicarTema(tema);
  anunciar(tema === 'claro' ? t('pwa.temaClaroActivado') : t('pwa.temaOscuroActivado'));
});

/* ================================================================
   5. Restablecer filtros
   ----------------------------------------------------------------
   Este modulo no conoce el estado de la app: emite un evento y app.js
   (vista regional) y amigos.js (grupo) deciden que significa "limpiar".
   ================================================================ */
btnRestablecer?.addEventListener('click', () => {
  dispatchEvent(new CustomEvent('restablecerfiltros'));
  anunciar(t('pwa.filtrosRestablecidos'));
});

/* ================================================================
   6. Ayuda
   ================================================================ */
let focoAntesDeAyuda = null;

btnAyuda?.addEventListener('click', () => {
  if (!dialogoAyuda) return;
  focoAntesDeAyuda = document.activeElement;
  if (typeof dialogoAyuda.showModal === 'function') dialogoAyuda.showModal();
  else dialogoAyuda.setAttribute('open', '');
  btnCerrarAyuda?.focus();
});

dialogoAyuda?.addEventListener('click', (evento) => {
  // Clic en el fondo (fuera de la caja) cierra.
  if (evento.target === dialogoAyuda) dialogoAyuda.close();
});

dialogoAyuda?.addEventListener('close', () => {
  if (focoAntesDeAyuda?.isConnected) focoAntesDeAyuda.focus();
});

/* ================================================================
   7. Window Controls Overlay
   ----------------------------------------------------------------
   Con la PWA instalada y la superposicion activa, la cabecera se
   coloca en la franja de la barra de titulo (env(titlebar-area-*)).
   Si la franja es angosta, baja a una fila propia para no solaparse
   con los botones del sistema. geometrychange llega en rafagas al
   redimensionar: se agrupa con 200 ms de espera.
   ================================================================ */
let temporizadorGeometria = null;

function sincronizarWco() {
  const wco = navigator.windowControlsOverlay;
  const cuerpo = document.body;
  if (!wco) {
    cuerpo.classList.remove('wco-visible', 'wco-angosto');
    cuerpo.dataset.wco = 'no-disponible';
    return;
  }
  const rectangulo = wco.getTitlebarAreaRect();
  cuerpo.classList.toggle('wco-visible', wco.visible);
  cuerpo.classList.toggle('wco-angosto', wco.visible && rectangulo.width < 760);
  cuerpo.dataset.wco = wco.visible ? 'visible' : 'oculto';
  cuerpo.dataset.wcoAncho = String(Math.round(rectangulo.width));
}

const programarSincronizacionWco = () => {
  clearTimeout(temporizadorGeometria);
  temporizadorGeometria = setTimeout(sincronizarWco, 200);
};

sincronizarWco();
navigator.windowControlsOverlay?.addEventListener('geometrychange', programarSincronizacionWco);
// Resincroniza tambien al cambiar el modo de presentacion (p. ej. el usuario
// activa la superposicion desde el menu de la ventana ya instalada).
matchMedia('(display-mode: window-controls-overlay)').addEventListener('change', programarSincronizacionWco);

/* ================================================================
   8. Panel de widgets
   ----------------------------------------------------------------
   Simulador del Widgets Board de Windows 11: en macOS no existe el
   panel del sistema, asi que el sexto control abre un <dialog> que
   pinta la misma Adaptive Card (manifest -> widgets/) que Windows
   mostraria, con datos pedidos al service worker. Los textos pasan
   por i18n con el prefijo "widgets.".
   ================================================================ */
const panelWidgets = crearPanelWidgets({
  boton: btnWidgets,
  anunciar,
  t: (clave, vars) => t(`widgets.${clave}`, vars),
  claveAlmacen: 'ranking-lan:widgets-instalados',
});

/* ================================================================
   Arranque de los controles
   ================================================================ */
marcarInstalada();
addEventListener('idiomacambiado', () => {
  marcarInstalada();
  aplicarTema(document.documentElement.dataset.tema ?? 'oscuro', false);
  panelWidgets.retraducir();
});

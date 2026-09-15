/**
 * Registro del service worker, aviso de nueva version y prompt de instalacion.
 * Modulo independiente de la logica de la app; solo comparte i18n.
 */
import { t } from './i18n.js';

const estadoSw = document.getElementById('estado-sw');
const toast = document.getElementById('toast-actualizacion');
const btnRecargar = document.getElementById('btn-recargar');
const btnInstalar = document.getElementById('btn-instalar');

/* El ultimo estado se recuerda para re-traducirlo si cambia el idioma. */
let ultimoEstado = null;

const informar = (clave, vars) => {
  ultimoEstado = { clave, vars };
  if (estadoSw) estadoSw.textContent = `Service worker: ${t(clave, vars)}`;
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
   ================================================================ */
let eventoInstalacion = null;

const yaInstalada = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: window-controls-overlay)').matches ||
  navigator.standalone === true;

window.addEventListener('beforeinstallprompt', (evento) => {
  // Evitamos el mini-infobar para usar nuestro propio boton.
  evento.preventDefault();
  eventoInstalacion = evento;
  if (btnInstalar && !yaInstalada()) btnInstalar.hidden = false;
});

if (btnInstalar) {
  btnInstalar.addEventListener('click', async () => {
    if (!eventoInstalacion) return;
    btnInstalar.disabled = true;
    eventoInstalacion.prompt();
    const { outcome } = await eventoInstalacion.userChoice;
    // El evento solo se puede usar una vez.
    eventoInstalacion = null;
    btnInstalar.disabled = false;
    if (outcome === 'accepted') btnInstalar.hidden = true;
  });
}

window.addEventListener('appinstalled', () => {
  eventoInstalacion = null;
  if (btnInstalar) btnInstalar.hidden = true;
});

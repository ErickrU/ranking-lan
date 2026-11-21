/**
 * Logos opcionales de la Microsoft Store (Partner Center → Store listings →
 * Store logos / Store display images), generados a partir del icono de la app
 * y sus colores de marca con la misma tecnica que capturas-tienda.mjs: una
 * pagina HTML renderizada en Chrome headless y capturada por CDP al tamano
 * exacto. Guarda en tienda/logos/:
 *   poster-720x1080.png     9:16 Poster art: icono centrado + nombre «Ranking LAN»
 *   box-art-1080x1080.png   1:1 Box art: icono + nombre
 *   tile-300x300.png        1:1 App tile icon: solo el icono sobre el fondo de marca
 *   tile-150x150.png        1:1 (150)
 *   tile-71x71.png          1:1 (71)
 *
 * El icono es iconos/icono.svg, la fuente vectorial de iconos/icono-512.png
 * (mismo podio, estrella y «LAN»; sin logos ni marcas de Riot), para que a
 * 1080 px no pierda nitidez. Los colores son los de css/estilos.css
 * (--fondo-a #0a0f1c, --fondo-b #04060b, --cian #28e5ff, --magenta #ff3cac,
 * --texto #e8f4ff) y la tipografia la de la cabecera (--fuente, 800, 0.22em).
 * Falla (exit 1) si algun PNG no mide exactamente lo que dice su nombre.
 *
 * Uso:  node herramientas/logos-tienda.mjs [--cdp 9335]
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cdp, espera, lanzarChrome, paginaInicial } from './cdp.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(RAIZ, 'tienda', 'logos');
const ICONO_SVG = join(RAIZ, 'iconos', 'icono.svg');

const flag = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : def;
};
const PUERTO_CDP = Number(flag('cdp', 9335));

/** Colores y tipografia de css/estilos.css. */
const MARCA = {
  fondoA: '#0a0f1c',
  fondoB: '#04060b',
  fondoIcono: '#0d1526',
  cian: '#28e5ff',
  magenta: '#ff3cac',
  texto: '#e8f4ff',
  fuente: "'Avenir Next', 'Segoe UI Variable Display', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif",
};

const iconoDataUri = `data:image/svg+xml;base64,${readFileSync(ICONO_SVG).toString('base64')}`;

/** Logo con nombre (poster y box art): icono con esquinas redondeadas y halo, nombre debajo. */
function htmlLogo({ ancho, alto, icono, fuente, separacion, desplazamiento = 0 }) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<style>
  html, body { margin: 0; width: ${ancho}px; height: ${alto}px; overflow: hidden; }
  body {
    position: relative;
    background:
      radial-gradient(circle at 50% ${50 + desplazamiento}%, rgba(40, 229, 255, 0.18), transparent 62%),
      linear-gradient(135deg, ${MARCA.fondoIcono} 0%, ${MARCA.fondoA} 45%, ${MARCA.fondoB} 100%);
    font-family: ${MARCA.fuente};
    color: ${MARCA.texto};
  }
  /* Rejilla tenue, como la del icono y el fondo de la app. */
  body::before {
    content: ''; position: absolute; inset: 0;
    background-image:
      linear-gradient(to right, rgba(40, 229, 255, 0.07) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(40, 229, 255, 0.07) 1px, transparent 1px);
    background-size: ${Math.round(ancho / 15)}px ${Math.round(ancho / 15)}px;
  }
  .caja {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: ${separacion}px;
    transform: translateY(${Math.round(alto * desplazamiento / 100)}px);
  }
  .icono {
    width: ${icono}px; height: ${icono}px;
    border-radius: ${Math.round(icono * 0.22)}px;
    overflow: hidden;
    box-shadow: 0 0 ${Math.round(icono * 0.14)}px rgba(40, 229, 255, 0.35), 0 ${Math.round(icono * 0.06)}px ${Math.round(icono * 0.18)}px rgba(0, 0, 0, 0.65);
    outline: 2px solid rgba(40, 229, 255, 0.35);
    outline-offset: -2px;
  }
  .icono img { display: block; width: 100%; height: 100%; }
  .nombre {
    margin: 0;
    font-size: ${fuente}px; font-weight: 800; line-height: 1.1;
    letter-spacing: 0.22em; text-transform: uppercase; white-space: nowrap;
    text-indent: 0.22em; /* compensa el espaciado final para que quede centrado */
    text-shadow: 0 0 ${Math.round(fuente * 0.6)}px rgba(40, 229, 255, 0.35);
  }
  .linea {
    width: ${Math.round(icono * 0.9)}px; height: ${Math.max(2, Math.round(fuente * 0.06))}px;
    background: linear-gradient(90deg, ${MARCA.cian}, transparent 30%, transparent 70%, ${MARCA.magenta});
    opacity: 0.9;
  }
</style></head>
<body>
  <div class="caja">
    <div class="icono"><img src="${iconoDataUri}" alt=""></div>
    <h1 class="nombre">Ranking LAN</h1>
    <div class="linea"></div>
  </div>
</body></html>`;
}

/** Solo el icono, a sangre: su propio fondo es el fondo de marca (#0d1526 → #04060b con rejilla). */
function htmlTile(lado) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<style>
  html, body { margin: 0; width: ${lado}px; height: ${lado}px; overflow: hidden; background: ${MARCA.fondoIcono}; }
  img { display: block; width: ${lado}px; height: ${lado}px; }
</style></head>
<body><img src="${iconoDataUri}" alt=""></body></html>`;
}

const LOGOS = [
  { archivo: 'poster-720x1080.png', ancho: 720, alto: 1080, html: htmlLogo({ ancho: 720, alto: 1080, icono: 440, fuente: 52, separacion: 54, desplazamiento: -4 }) },
  { archivo: 'box-art-1080x1080.png', ancho: 1080, alto: 1080, html: htmlLogo({ ancho: 1080, alto: 1080, icono: 580, fuente: 72, separacion: 56, desplazamiento: 2 }) },
  { archivo: 'tile-300x300.png', ancho: 300, alto: 300, html: htmlTile(300) },
  { archivo: 'tile-150x150.png', ancho: 150, alto: 150, html: htmlTile(150) },
  { archivo: 'tile-71x71.png', ancho: 71, alto: 71, html: htmlTile(71) },
];

const { chrome, perfil } = lanzarChrome(PUERTO_CDP);
let cdp;
let codigoSalida = 0;

async function renderizar({ archivo, ancho, alto, html }) {
  await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 1, mobile: false });
  await cdp.enviar('Page.navigate', { url: `data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}` });
  // Fuentes e imagen (el SVG embebido) listas antes de capturar.
  for (let i = 0; i < 40; i++) {
    try {
      const listo = await cdp.evaluar(`document.readyState === 'complete'
        && [...document.images].every((img) => img.complete && img.naturalWidth > 0)
        && document.fonts.status === 'loaded'`);
      if (listo) break;
    } catch { /* navegando */ }
    await espera(100);
  }
  await espera(200);
  const { data } = await cdp.enviar('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: ancho, height: alto, scale: 1 },
  });
  const ruta = join(DESTINO, archivo);
  writeFileSync(ruta, Buffer.from(data, 'base64'));
  const cabecera = readFileSync(ruta);
  const anchoReal = cabecera.readUInt32BE(16);
  const altoReal = cabecera.readUInt32BE(20);
  if (anchoReal !== ancho || altoReal !== alto) {
    throw new Error(`${archivo} mide ${anchoReal}x${altoReal}, se esperaba ${ancho}x${alto}`);
  }
  console.log(`ok ${join('tienda', 'logos', archivo)} ${anchoReal}x${altoReal}`);
}

try {
  mkdirSync(DESTINO, { recursive: true });
  const objetivo = await paginaInicial(PUERTO_CDP);
  cdp = await Cdp.conectar(objetivo.webSocketDebuggerUrl);
  await cdp.enviar('Runtime.enable');
  await cdp.enviar('Page.enable');
  for (const logo of LOGOS) await renderizar(logo);
} catch (error) {
  console.error('\nNo se pudieron generar los logos:', error.message);
  codigoSalida = 1;
} finally {
  cdp?.cerrar();
  chrome.kill('SIGKILL');
  await espera(300);
  rmSync(perfil, { recursive: true, force: true });
  process.exit(codigoSalida);
}

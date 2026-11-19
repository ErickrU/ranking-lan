/**
 * Cliente minimo de Chrome DevTools Protocol compartido por las herramientas
 * (verificar.mjs y capturas-tienda.mjs). Sin dependencias: usa el WebSocket
 * nativo de Node (>= 22) y arranca Chrome headless con un perfil temporal.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================
   Cliente CDP minimo
   ================================================================ */
export class Cdp {
  #ws; #id = 0; #pendientes = new Map();
  eventos = [];

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (e) => {
      const mensaje = JSON.parse(e.data);
      if (mensaje.id !== undefined) {
        const pendiente = this.#pendientes.get(mensaje.id);
        this.#pendientes.delete(mensaje.id);
        mensaje.error ? pendiente?.rechazar(new Error(mensaje.error.message)) : pendiente?.resolver(mensaje.result);
      } else {
        this.eventos.push(mensaje);
      }
    });
  }

  static async conectar(url) {
    const ws = new WebSocket(url);
    await new Promise((resolver, rechazar) => {
      ws.addEventListener('open', resolver, { once: true });
      ws.addEventListener('error', () => rechazar(new Error('No se pudo abrir el WebSocket de CDP')), { once: true });
    });
    return new Cdp(ws);
  }

  enviar(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolver, rechazar) => {
      this.#pendientes.set(id, { resolver, rechazar });
      this.#ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.#pendientes.delete(id)) rechazar(new Error(`Tiempo agotado en ${method}`));
      }, 30_000);
    });
  }

  /** Evalua JS en la pagina y devuelve el valor ya deserializado. */
  async evaluar(expresion) {
    const { result, exceptionDetails } = await this.enviar('Runtime.evaluate', {
      expression: expresion,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'Error al evaluar');
    return result.value;
  }

  cerrar() { this.#ws.close(); }
}

/* ================================================================
   Arranque de Chrome headless
   ================================================================ */

/**
 * Lanza Chrome headless con un perfil temporal y el puerto CDP indicado.
 * Devuelve { chrome, perfil }: el proceso hijo y la ruta del perfil, que el
 * llamador debe borrar (rmSync) al terminar.
 */
export function lanzarChrome(puertoCdp) {
  const perfil = mkdtempSync(join(tmpdir(), 'ranking-lan-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${puertoCdp}`,
    `--user-data-dir=${perfil}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' });
  return { chrome, perfil };
}

/** Espera (hasta 15 s) a que Chrome exponga el target de pagina inicial y lo devuelve. */
export async function paginaInicial(puertoCdp) {
  let objetivo;
  for (let intento = 0; intento < 60; intento++) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${puertoCdp}/json/list`)).json();
      objetivo = lista.find((t) => t.type === 'page');
      if (objetivo?.webSocketDebuggerUrl) break;
    } catch { /* Chrome aun no escucha */ }
    await espera(250);
  }
  if (!objetivo?.webSocketDebuggerUrl) throw new Error('Chrome no expuso ningún target de página');
  return objetivo;
}

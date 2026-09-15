/**
 * Genera datos/ranking-lan.json: el conjunto de datos de DEMOSTRACION que la PWA
 * usa cuando no hay una clave de la API de Riot configurada (y como respaldo
 * offline si nunca se ha podido contactar al proxy).
 *
 * Los Riot ID son FICTICIOS a proposito. No se atribuyen puntos, rachas ni
 * posiciones a personas reales: para datos reales hay que arrancar el proxy con
 * una RIOT_API_KEY (ver README.md).
 *
 * Uso:  node herramientas/generar-datos-demo.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ *
 * PRNG determinista (LCG) para que el archivo generado sea estable.
 * ------------------------------------------------------------------ */
let semilla = 20260914;
const aleatorio = () => {
  semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
  return semilla / 0x7fffffff;
};
const entero = (min, max) => min + Math.floor(aleatorio() * (max - min + 1));
const oportunidad = (p) => aleatorio() < p;
const elegir = (lista) => lista[Math.floor(aleatorio() * lista.length)];

/* ------------------------------------------------------------------ *
 * Piezas para construir Riot ID ficticios con sabor latinoamericano.
 * ------------------------------------------------------------------ */
const PREFIJOS = [
  'Sombra', 'Jaguar', 'Condor', 'Quetzal', 'Volcan', 'Trueno', 'Neblina',
  'Colibri', 'Puma', 'Zorro', 'Halcon', 'Lobo', 'Cactus', 'Marea',
  'Relampago', 'Ceniza', 'Obsidiana', 'Cometa', 'Duna', 'Selva',
  'Aurora', 'Tormenta', 'Cristal', 'Hierro', 'Bruma', 'Chispa',
  'Nopal', 'Ajolote', 'Tucan', 'Iguana', 'Coyote', 'Vicuna',
];
const SUFIJOS = [
  'delSur', 'Nocturno', 'Errante', 'Veloz', 'Sagaz', 'Fugaz', 'Eterno',
  'Silente', 'Feroz', 'Astral', 'Carmesi', 'Dorado', 'Glacial', 'Salvaje',
  'Sereno', 'Titan', 'Mistico', 'Bravo', 'Radiante', 'Furtivo',
];
const TAGS = ['LAN', 'LAN1', 'MX1', 'MEX', 'PER', 'CHI', 'ARG', 'COL', 'CRC', 'GDL', 'LIM', 'BOG', 'SCL', 'MTY', 'UTEC'];

const usados = new Set();
function riotIdUnico() {
  for (let intento = 0; intento < 5000; intento++) {
    const base = `${elegir(PREFIJOS)}${elegir(SUFIJOS)}`;
    const nombre = oportunidad(0.25) ? `${base}${entero(2, 99)}` : base;
    const tag = elegir(TAGS);
    const id = `${nombre}#${tag}`;
    if (!usados.has(id)) {
      usados.add(id);
      return { nombre, tag, riotId: id };
    }
  }
  throw new Error('No se pudieron generar Riot ID unicos');
}

/* PUUID ficticio con la longitud tipica (78 caracteres) para que la forma
   del objeto coincida con la respuesta real de la API. */
const ALFABETO = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const puuidFalso = () =>
  Array.from({ length: 78 }, () => ALFABETO[Math.floor(aleatorio() * ALFABETO.length)]).join('');

/* ------------------------------------------------------------------ *
 * Rangos de LP por tier, coherentes con como funciona el ladder real:
 * Challenger > Grandmaster > Master.
 * ------------------------------------------------------------------ */
const TIERS = {
  CHALLENGER:  { cantidad: 60, lpMax: 2050, lpMin: 1180 },
  GRANDMASTER: { cantidad: 50, lpMin: 820,  lpMax: 1175 },
  MASTER:      { cantidad: 70, lpMin: 340,  lpMax: 815  },
};
const COLAS = ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'];

function generarTier(tier, cola) {
  const { cantidad, lpMin, lpMax } = TIERS[tier];
  const jugadores = [];

  // LP descendente: se reparte el rango y se le añade ruido.
  const paso = (lpMax - lpMin) / cantidad;
  let lp = lpMax;

  for (let i = 0; i < cantidad; i++) {
    const { nombre, tag, riotId } = riotIdUnico();
    lp = Math.max(lpMin, Math.round(lp - paso * (0.55 + aleatorio() * 0.9)));

    // Mas partidas en la cima del ladder; winrate realista (49 % - 60 %).
    const partidas = entero(tier === 'CHALLENGER' ? 380 : 210, tier === 'CHALLENGER' ? 980 : 620);
    const winrate = 0.49 + aleatorio() * 0.11;
    const victorias = Math.round(partidas * winrate);

    jugadores.push({
      puesto: i + 1,
      riotId,
      nombre,
      tag,
      puuid: puuidFalso(),
      tier,
      division: 'I',
      lp,
      victorias,
      derrotas: partidas - victorias,
      racha: oportunidad(0.14),
      veterano: oportunidad(tier === 'CHALLENGER' ? 0.45 : 0.28),
      nuevo: oportunidad(0.1),
      inactivo: oportunidad(0.05),
      cola,
    });
  }
  return jugadores;
}

/* ------------------------------------------------------------------ */
const listados = {};
for (const cola of COLAS) {
  for (const tier of Object.keys(TIERS)) {
    listados[`${cola}|${tier}`] = generarTier(tier, cola);
  }
}

const documento = {
  esquema: 1,
  fuente: 'demo',
  aviso:
    'Datos de demostracion con Riot ID ficticios. No representan el ladder real de LAN. ' +
    'Para datos reales arranca el proxy con una RIOT_API_KEY (ver README.md).',
  region: 'LAN',
  regionNombre: 'Latinoamerica Norte',
  plataforma: 'la1',
  actualizado: new Date('2026-09-14T18:00:00Z').toISOString(),
  listados,
};

mkdirSync(join(RAIZ, 'datos'), { recursive: true });
const destino = join(RAIZ, 'datos', 'ranking-lan.json');
writeFileSync(destino, JSON.stringify(documento, null, 1) + '\n', 'utf8');

const total = Object.values(listados).reduce((n, l) => n + l.length, 0);
console.log(`Escrito ${destino}`);
console.log(`  ${Object.keys(listados).length} listados, ${total} jugadores ficticios`);

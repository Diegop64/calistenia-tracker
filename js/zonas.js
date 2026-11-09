// Zonas del cuerpo: cada ejercicio cuenta en UNA zona (la principal) para que los totales no se inflen.
// Los ejercicios de la biblioteca la traen por su `clave`; en los tuyos la eliges al crearlos/editarlos.
// ejercicios.zona (opcional): 'hombro' | 'pecho' | 'espalda' | 'brazos' | 'core' | 'pierna' | 'ninguna'.
// Funciones puras: no tocan el DOM ni la base de datos.

import { addDays, parseISO, isoDate } from './util.js';
import { serieHecha } from './stats.js';

export const ZONAS = [
  { k: 'hombro', n: 'Hombro' },
  { k: 'pecho', n: 'Pecho y tríceps' },
  { k: 'espalda', n: 'Espalda' },
  { k: 'brazos', n: 'Bíceps y brazos' },
  { k: 'core', n: 'Core' },
  { k: 'pierna', n: 'Pierna' },
];
export const nombreZona = (k) => ZONAS.find((z) => z.k === k)?.n || 'Sin zona';

/** Zona principal de cada ejercicio de la biblioteca (por su clave estable). */
export const ZONAS_BIB = {
  // Press a pino
  'pino-pike': 'hombro', 'pino-pike-elev': 'hombro', 'pino-pelota': 'hombro', 'pino-militar': 'hombro',
  'pino-hold': 'hombro', 'pino-hold-libre': 'hombro', 'pino-neg': 'hombro', 'pino-pared': 'hombro', 'pino-libre': 'hombro',
  // Front lever
  'fl-tuck': 'espalda', 'fl-adv': 'espalda', 'fl-straddle': 'espalda', 'fl-full': 'espalda',
  'fl-tuck-pullup': 'espalda', 'fl-one-leg': 'espalda', 'fl-tuck-raise': 'espalda', 'fl-remo': 'espalda', 'fl-piernas': 'core',
  // Back lever
  'bl-german': 'hombro', 'bl-skin': 'espalda', 'bl-tuck': 'espalda', 'bl-adv': 'espalda', 'bl-straddle': 'espalda', 'bl-full': 'espalda',
  // Planche
  'pl-plancha': 'core', 'pl-lean': 'hombro', 'pl-lean-pu': 'pecho', 'pl-tuck-pu': 'pecho',
  'pl-tuck': 'hombro', 'pl-adv': 'hombro', 'pl-straddle': 'hombro', 'pl-full': 'hombro',
  // Muscle-up
  'mu-explosiva': 'espalda', 'mu-banda': 'espalda', 'mu-pecho': 'espalda', 'mu-fondos': 'pecho', 'mu-neg': 'espalda', 'mu-barra': 'espalda',
  // Dominadas y tracción
  'tr-escapulares': 'espalda', 'tr-asistidas': 'espalda', 'tr-negativas': 'espalda', 'tr-supinas': 'espalda', 'tr-pronas': 'espalda', 'tr-arquero': 'espalda', 'tr-lastre': 'espalda', 'tr-curl': 'brazos', 'tr-hang': 'brazos',
  // Fondos y empuje
  'em-flexiones': 'pecho', 'em-declinadas': 'pecho', 'em-diamante': 'pecho', 'em-arquero': 'pecho', 'em-fondos': 'pecho', 'em-fondos-lastre': 'pecho',
  // Core
  'co-tuck-lsit': 'core', 'co-lsit': 'core', 'co-vsit': 'core', 'co-hollow': 'core', 'co-dragon': 'core',
  // Pierna
  'pi-sentadilla': 'pierna', 'pi-hip': 'pierna', 'pi-gemelos': 'pierna', 'pi-shrimp': 'pierna', 'pi-bulgara': 'pierna', 'pi-pistol-asist': 'pierna', 'pi-pistol': 'pierna', 'pi-nordic': 'pierna',
  // Bandera
  'ba-vertical': 'core', 'ba-tuck': 'core', 'ba-straddle': 'core', 'ba-full': 'core',
};

/** La que elegiste tú manda; si no, la de la biblioteca; si no, null. */
export const zonaDe = (ej) => {
  if (!ej || ej.zona === 'ninguna') return null;   // 'ninguna' = le quitaste a propósito la zona de biblioteca
  return ej.zona || ZONAS_BIB[ej.clave] || null;
};

/** Lunes de la semana de `iso`. */
export const lunes = (iso) => addDays(iso, -((parseISO(iso).getDay() + 6) % 7));

/**
 * Totales por zona en [desde, hasta] (ambos incluidos, 'YYYY-MM-DD').
 * Devuelve Map zona -> { entrenos, series, reps, segundos, kg } ('sin' = ejercicios sin zona).
 * reps: tipos 'reps' y 'complejo' · segundos: tipo 'tiempo' · kg: lastre × reps.
 */
export function totalesZona(state, desde, hasta) {
  const ejById = new Map(state.ejercicios.map((e) => [e.id, e]));
  const entFecha = new Map(state.entrenamientos.map((e) => [e.id, e.fecha]));
  const out = new Map();
  for (const s of state.series) {
    if (!serieHecha(s)) continue;
    const f = entFecha.get(s.entrenamiento_id);
    if (!f || f < desde || f > hasta) continue;
    const ej = ejById.get(s.ejercicio_id); if (!ej) continue;
    const z = zonaDe(ej) || 'sin';
    let t = out.get(z);
    if (!t) out.set(z, (t = { ents: new Set(), series: 0, reps: 0, segundos: 0, kg: 0 }));
    t.ents.add(s.entrenamiento_id);
    t.series++;
    if (ej.tipo === 'tiempo') t.segundos += s.valor;
    else { t.reps += s.valor; if (s.peso_extra) t.kg += s.peso_extra * s.valor; }
  }
  for (const t of out.values()) { t.entrenos = t.ents.size; delete t.ents; }
  return out;
}

/** Series hechas por zona en cada una de las últimas `n` semanas (lunes a domingo), de la más antigua a la actual. */
export function seriesPorSemana(state, hasta, n = 8) {
  const ini = lunes(hasta);
  const semanas = Array.from({ length: n }, (_, i) => addDays(ini, -7 * (n - 1 - i)));
  const porZona = new Map();
  semanas.forEach((d, i) => {
    for (const [z, t] of totalesZona(state, d, addDays(d, 6))) {
      if (!porZona.has(z)) porZona.set(z, Array(n).fill(0));
      porZona.get(z)[i] = t.series;
    }
  });
  return { semanas, porZona };
}

/** Periodos: actual y anterior de la misma duración. */
export function periodo(tipo, ref = isoDate()) {
  if (tipo === 'semana') {
    const d = lunes(ref);
    return { desde: d, hasta: ref, prevDesde: addDays(d, -7), prevHasta: addDays(d, -7 + Math.round((parseISO(ref) - parseISO(d)) / 86400000)) };
  }
  const dias = tipo === '12s' ? 84 : 28;
  const desde = addDays(ref, -dias + 1);
  return { desde, hasta: ref, prevDesde: addDays(desde, -dias), prevHasta: addDays(desde, -1) };
}

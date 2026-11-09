// Cálculo de progresión. Funciones puras: reciben el estado y devuelven datos.

import { parseISO } from './util.js';

/** Una serie cuenta en las estadísticas si tiene valor y no está marcada explícitamente como pendiente. */
export const serieHecha = (s) => s.valor > 0 && s.hecha !== false;

export const METRICAS = {
  max:     { id: 'max',     label: 'Mejor serie',  desc: 'Máx. reps / segundos en una serie' },
  volumen: { id: 'volumen', label: 'Volumen',      desc: 'Total de reps / segundos del día' },
  lastre:  { id: 'lastre',  label: 'Lastre máx.',  desc: 'Mayor peso extra usado (kg)' },
  aguante: { id: 'aguante', label: 'Aguante máx.', desc: 'Mayor aguante por repetición (segundos)' },
};

/** Series válidas (con valor > 0) de un ejercicio, agrupadas por entrenamiento y ordenadas por fecha. */
export function sesionesDeEjercicio(state, ejercicioId) {
  const entMap = new Map(state.entrenamientos.map((e) => [e.id, e]));
  const porEnt = new Map();
  for (const s of state.series) {
    if (s.ejercicio_id !== ejercicioId || !serieHecha(s)) continue;
    const ent = entMap.get(s.entrenamiento_id);
    if (!ent) continue;
    if (!porEnt.has(ent.id)) porEnt.set(ent.id, { entrenamiento_id: ent.id, fecha: ent.fecha, sets: [] });
    porEnt.get(ent.id).sets.push(s);
  }
  const out = [...porEnt.values()].map((ses) => {
    ses.sets.sort((a, b) => a.set_numero - b.set_numero);
    ses.max = Math.max(...ses.sets.map((s) => s.valor));
    ses.volumen = ses.sets.reduce((t, s) => t + s.valor, 0);
    ses.lastre = Math.max(0, ...ses.sets.map((s) => s.peso_extra || 0));
    ses.aguante = Math.max(0, ...ses.sets.map((s) => s.segundos || 0));   // solo ejercicios complejos
    ses.nSets = ses.sets.length;
    return ses;
  });
  out.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return out;
}

export const valorMetrica = (ses, metrica) => ses[metrica] ?? ses.max;

/**
 * Tendencia: compara la media de las últimas k sesiones con la de las k anteriores
 * (k hasta 3). Umbral ±2,5 % para considerar "estancado".
 */
export function tendencia(valores) {
  const n = valores.length;
  if (n < 2) return { estado: 'na', pct: null };
  const k = Math.min(3, Math.floor(n / 2));
  const media = (a) => a.reduce((t, v) => t + v, 0) / a.length;
  const reciente = media(valores.slice(n - k));
  const previo = media(valores.slice(n - 2 * k, n - k));
  if (!(previo > 0)) return { estado: reciente > 0 ? 'up' : 'flat', pct: null };
  const pct = ((reciente - previo) / previo) * 100;
  const estado = pct > 2.5 ? 'up' : pct < -2.5 ? 'down' : 'flat';
  return { estado, pct };
}

export function resumenEjercicio(state, ejercicioId, metrica = 'max') {
  const sesiones = sesionesDeEjercicio(state, ejercicioId);
  const valores = sesiones.map((s) => valorMetrica(s, metrica));
  const ultima = sesiones[sesiones.length - 1] || null;
  const record = valores.length ? Math.max(...valores) : null;
  return { sesiones, valores, ultima, record, tend: tendencia(valores) };
}

/** Sesión anterior (estrictamente anterior a `fecha`) de un ejercicio. */
export function sesionPrevia(state, ejercicioId, fecha) {
  const ses = sesionesDeEjercicio(state, ejercicioId).filter((s) => s.fecha < fecha);
  return ses[ses.length - 1] || null;
}

/**
 * Progreso combinado de un objetivo: para cada ejercicio, índice = valor / valor inicial * 100
 * (100 = punto de partida). Entre sesiones se arrastra el último valor conocido y se promedia
 * entre los ejercicios que ya han empezado. Mide si el conjunto os acerca al objetivo.
 */
export function progresoObjetivo(state, objetivoId) {
  const ejercicios = state.ejercicios.filter((e) => e.objetivo_id === objetivoId);
  const series = [];
  for (const ej of ejercicios) {
    const ses = sesionesDeEjercicio(state, ej.id);
    if (!ses.length || !(ses[0].max > 0)) continue;
    series.push({ ej, ses, base: ses[0].max });
  }
  const fechas = [...new Set(series.flatMap((s) => s.ses.map((x) => x.fecha)))].sort();
  const puntos = fechas.map((f) => {
    const idx = series.map((s) => {
      let ult = null;
      for (const x of s.ses) { if (x.fecha <= f) ult = x; else break; }
      return ult ? (ult.max / s.base) * 100 : null;
    }).filter((v) => v != null);
    return { fecha: f, y: idx.reduce((t, v) => t + v, 0) / idx.length };
  });
  return {
    ejercicios,
    puntos,
    tend: tendencia(puntos.map((p) => p.y)),
    porEjercicio: series.map((s) => ({
      ej: s.ej,
      tend: tendencia(s.ses.map((x) => x.max)),
      inicio: s.base,
      actual: s.ses[s.ses.length - 1].max,
      cambioPct: ((s.ses[s.ses.length - 1].max - s.base) / s.base) * 100,
    })),
  };
}

export const diasEntre = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

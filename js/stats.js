// Cálculo de progresión. Funciones puras: reciben el estado y devuelven datos.

import { parseISO } from './util.js';
import { CARGA_BIB } from './biblioteca.js';

/** Una serie cuenta en las estadísticas si tiene valor y no está marcada explícitamente como pendiente. */
export const serieHecha = (s) => s.valor > 0 && s.hecha !== false;

export const METRICAS = {
  max:     { id: 'max',     label: 'Mejor serie',  desc: 'Máx. reps / segundos en una serie' },
  fuerza:  { id: 'fuerza',  label: 'Fuerza',       desc: 'Fuerza estimada (kg): la carga que moverías a 1 repetición, contando tu peso corporal, el lastre o la banda' },
  volumen: { id: 'volumen', label: 'Volumen',      desc: 'Total de reps / segundos del día' },
  lastre:  { id: 'lastre',  label: 'Lastre máx.',  desc: 'Mayor lastre usado (kg)' },
  banda:   { id: 'banda',   label: 'Banda',        desc: 'Asistencia de la banda (kg); menos es mejor' },
  aguante: { id: 'aguante', label: 'Aguante máx.', desc: 'Mayor aguante por repetición (segundos)' },
};

/**
 * Qué carga mueve un ejercicio: f = parte del peso corporal (1 todo, 0 = solo los kg), asist = los kg son banda (restan).
 * Lo que elijas en el ejercicio manda; si no, lo de la biblioteca; si no, peso corporal completo.
 */
export function cargaDe(ej) {
  const b = (ej && CARGA_BIB[ej.clave]) || {};
  return { f: ej?.factor ?? b.f ?? 1, asist: ej?.asistido ?? b.asist ?? false };
}

/** Peso corporal vigente en una fecha: el último anotado hasta ese día (o el primero que haya, si aún no habías anotado ninguno). */
export function pesoCorporalEn(state, fecha) {
  const con = state.entrenamientos.filter((e) => e.peso_corporal > 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!con.length) return null;
  let p = con[0].peso_corporal;
  for (const e of con) { if (e.fecha <= fecha) p = e.peso_corporal; else break; }
  return p;
}

/** Fuerza estimada de una serie (Epley): carga × (1 + reps/30). null si no se puede calcular. */
function fuerzaSerie(s, carga, bw) {
  const kg = s.peso_extra || 0;
  let c = carga.f > 0 ? (bw ? carga.f * bw : null) : 0;
  if (c == null) return null;
  c += carga.asist ? -kg : kg;
  if (!(c > 0) || !(s.valor > 0)) return null;
  return c * (1 + Math.min(s.valor, 20) / 30);   // más allá de ~20 reps la fórmula deja de tener sentido
}

/** Fuerza estimada de una serie suelta (para avisar de récord mientras entrenas). */
export const fuerzaDeSerie = (state, ej, s, fecha) => fuerzaSerie(s, cargaDe(ej), pesoCorporalEn(state, fecha));

/** Series válidas (con valor > 0) de un ejercicio, agrupadas por entrenamiento y ordenadas por fecha. */
export function sesionesDeEjercicio(state, ejercicioId) {
  const ej = state.ejercicios.find((e) => e.id === ejercicioId);
  const carga = cargaDe(ej);
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
    ses.sets.sort((a, b) => (a.bloque || 0) - (b.bloque || 0) || a.set_numero - b.set_numero);   // tandas repetidas en orden
    ses.max = Math.max(...ses.sets.map((s) => s.valor));
    ses.volumen = ses.sets.reduce((t, s) => t + s.valor, 0);
    const kgs = ses.sets.map((s) => s.peso_extra || 0);
    ses.lastre = carga.asist ? 0 : Math.max(0, ...kgs);
    ses.banda = carga.asist ? Math.min(...kgs) : 0;   // la sesión con menos ayuda
    ses.aguante = Math.max(0, ...ses.sets.map((s) => s.segundos || 0));   // solo ejercicios complejos
    ses.nSets = ses.sets.length;
    if (ej && ej.tipo !== 'tiempo') {
      const bw = pesoCorporalEn(state, ses.fecha);
      const fs = ses.sets.map((s) => fuerzaSerie(s, carga, bw)).filter((v) => v != null);
      ses.fuerza = fs.length ? Math.max(...fs) : null;
    } else ses.fuerza = null;
    return ses;
  });
  out.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return out;
}

export const valorMetrica = (ses, metrica) => ses[metrica] ?? ses.max;

/**
 * Métrica con la que se mide el progreso de un ejercicio: «fuerza» cuando la carga cambia la lectura
 * (lastre, banda o kg externos como en el press militar) y se puede calcular en todas las sesiones; si no, «mejor serie».
 */
export function metricaPrincipal(ej, sesiones) {
  if (!ej || ej.tipo === 'tiempo' || !sesiones.length) return 'max';
  const c = cargaDe(ej);
  const importaCarga = c.asist || c.f === 0 || sesiones.some((s) => s.lastre > 0);
  return importaCarga && sesiones.every((s) => s.fuerza > 0) ? 'fuerza' : 'max';
}

/**
 * Tendencia: compara la MEJOR marca de las últimas k sesiones con la mejor de las k anteriores (k hasta 3).
 * Con menos de 4 sesiones no opina. Estancado si el cambio es ≤ 2,5 % o menor que `abs` (p. ej. 2 s en aguantes).
 * Así un día flojo o una sesión suave a propósito no le dan la vuelta.
 */
export function tendencia(valores, { abs = 0 } = {}) {
  const n = valores.length;
  if (n < 4) return { estado: 'na', pct: null };
  const k = Math.min(3, Math.floor(n / 2));
  const reciente = Math.max(...valores.slice(n - k));
  const previo = Math.max(...valores.slice(n - 2 * k, n - k));
  if (!(previo > 0)) return { estado: reciente > 0 ? 'up' : 'flat', pct: null };
  const pct = ((reciente - previo) / previo) * 100;
  const estado = Math.abs(pct) <= 2.5 || Math.abs(reciente - previo) < abs ? 'flat' : pct > 0 ? 'up' : 'down';
  return { estado, pct };
}
const umbral = (ej, m) => (m === 'max' && ej?.tipo === 'tiempo' ? { abs: 2 } : {});

export function resumenEjercicio(state, ejercicioId, metrica = 'auto') {
  const ej = state.ejercicios.find((e) => e.id === ejercicioId);
  const sesiones = sesionesDeEjercicio(state, ejercicioId);
  const m = metrica === 'auto' ? metricaPrincipal(ej, sesiones) : metrica;
  const valores = sesiones.map((s) => valorMetrica(s, m));
  const ultima = sesiones[sesiones.length - 1] || null;
  const record = valores.length ? (m === 'banda' ? Math.min(...valores) : Math.max(...valores)) : null;
  let tend = tendencia(m === 'banda' ? valores.map((v) => -v) : valores, umbral(ej, m));
  if (m === 'banda' && tend.pct != null) tend = { ...tend, pct: -tend.pct };
  // Sin peso corporal no hay «fuerza»: al menos, más lastre con menos reps no es «bajar».
  if (m === 'max' && tend.estado === 'down' && sesiones.length >= 4) {
    const k = Math.min(3, Math.floor(sesiones.length / 2)), n = sesiones.length;
    const l = (a) => Math.max(0, ...a.map((s) => s.lastre));
    if (l(sesiones.slice(n - k)) > l(sesiones.slice(n - 2 * k, n - k))) tend = { estado: 'flat', pct: null, nota: 'más lastre' };
  }
  return { sesiones, valores, ultima, record, tend, metrica: m };
}

/** Sesión anterior (estrictamente anterior a `fecha`) de un ejercicio. */
export function sesionPrevia(state, ejercicioId, fecha) {
  const ses = sesionesDeEjercicio(state, ejercicioId).filter((s) => s.fecha < fecha);
  return ses[ses.length - 1] || null;
}

export const diasEntre = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

/**
 * Progreso combinado de un objetivo: para cada ejercicio, índice = valor / valor inicial × 100 (100 = punto de partida),
 * con su métrica principal (fuerza si hay lastre/banda, si no mejor serie). En cada fecha cuentan solo los ejercicios
 * entrenados en las 6 semanas anteriores (una progresión superada deja de pesar) y se combinan con media geométrica,
 * para que un ejercicio que pasa de 1 a 4 reps (índice 400) no tape al resto.
 */
export function progresoObjetivo(state, objetivoId) {
  const ejercicios = state.ejercicios.filter((e) => e.objetivo_id === objetivoId);
  const series = [];
  for (const ej of ejercicios) {
    const ses = sesionesDeEjercicio(state, ej.id);
    const m = metricaPrincipal(ej, ses);
    const vals = ses.map((s) => valorMetrica(s, m));
    if (!ses.length || !(vals[0] > 0)) continue;
    series.push({ ej, ses, vals, m, base: vals[0] });
  }
  const fechas = [...new Set(series.flatMap((s) => s.ses.map((x) => x.fecha)))].sort();
  const puntos = fechas.map((f) => {
    const idx = series.map((s) => {
      let i = -1;
      for (let j = 0; j < s.ses.length; j++) { if (s.ses[j].fecha <= f) i = j; else break; }
      if (i < 0 || diasEntre(s.ses[i].fecha, f) > 42) return null;
      return (s.vals[i] / s.base) * 100;
    }).filter((v) => v > 0);
    return { fecha: f, y: idx.length ? Math.exp(idx.reduce((t, v) => t + Math.log(v), 0) / idx.length) : null };
  }).filter((p) => p.y != null);
  return {
    ejercicios,
    puntos,
    tend: tendencia(puntos.map((p) => p.y)),
    porEjercicio: series.map((s) => ({
      ej: s.ej,
      metrica: s.m,
      tend: tendencia(s.vals, umbral(s.ej, s.m)),
      inicio: s.base,
      actual: s.vals[s.vals.length - 1],
      cambioPct: ((s.vals[s.vals.length - 1] - s.base) / s.base) * 100,
    })),
  };
}

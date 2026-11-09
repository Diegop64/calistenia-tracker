// Resumen en texto de tus entrenos para pegarlo en una IA (ChatGPT, Claude…).
// Función pura: recibe el estado y devuelve un texto en Markdown. No toca el DOM ni la base de datos.

import { num, fechaLarga, parseISO } from './util.js';
import { serieHecha, sesionesDeEjercicio, progresoObjetivo, tendencia, metricaPrincipal, cargaDe } from './stats.js';
import { ZONAS, nombreZona, totalesZona, zonaDe } from './zonas.js';

export const SENSACIONES = ['Fuerte', 'Bien', 'Flojo', 'Cansado'];
export const MOLESTIAS = ['Hombro derecho', 'Hombro izquierdo', 'Codo', 'Muñeca', 'Cuello', 'Espalda alta', 'Espalda baja', 'Cadera', 'Rodilla', 'Otra'];

export const INSTRUCCIONES_IA = `Actúa como un entrenador de calistenia con experiencia en progresiones, programación y prevención de lesiones. A continuación tienes mi registro de entrenamiento. Analízalo y respóndeme con:

1. Qué está funcionando y qué está estancado (apóyate en las tendencias y los récords).
2. Cómo se relacionan mi energía, mis sensaciones y mis molestias con el volumen y los ejercicios de cada día.
3. Señales de sobrecarga o riesgo (molestias que se repiten, caídas de rendimiento) y cómo gestionarlas.
4. Ajustes concretos para las próximas 2-4 semanas: ejercicios, series, repeticiones o segundos, descansos y progresión.
5. Qué otros datos debería anotar para que el próximo análisis sea mejor.

Cómo leer los datos: «+5kg» es lastre; «−10kg banda» es asistencia de una banda (menos asistencia = progreso); en ejercicios marcados «carga: solo kg» (press, curl, sentadilla con barra) los kg son la carga total. «Fuerza estimada» = carga × (1 + reps/30) contando mi peso corporal: si sube el lastre y bajan las reps, mira la fuerza, no las reps. Las tendencias son automáticas y con pocas sesiones pueden ser ruido.

Si necesitas contexto (edad, experiencia, objetivos, material), pregúntame antes de proponer cambios. No des consejo médico: si hay dolor persistente, recomiéndame consultar a un profesional.`;

const TEND = { up: 'mejorando', flat: 'estancado', down: 'bajando', na: 'pocos datos' };
const pct = (t) => (t.pct != null ? ` ${t.pct > 0 ? '+' : ''}${num(t.pct, 0)} %` : '');
const tendTxt = (t) => `${TEND[t.estado]}${t.estado === 'na' ? '' : pct(t)}`;
const fechaCompleta = (iso) => `${fechaLarga(iso)} ${parseISO(iso).getFullYear()}`;

/** «8» · «30 s» · «8×10s» (complejo: reps × aguante por repetición) · y «+5kg» si lleva lastre. */
export function textoSerie(s, tipo, asist = false) {
  const base = tipo === 'tiempo' ? `${num(s.valor, 0)} s` : `${num(s.valor, 0)}`;
  const aguante = tipo === 'complejo' && s.segundos ? `×${num(s.segundos, 0)}s` : '';
  const kg = s.peso_extra ? (asist ? `−${num(s.peso_extra)}kg banda` : `+${num(s.peso_extra)}kg`) : '';
  return `${base}${aguante}${kg}`;
}

const UNIDAD = { reps: 'reps', tiempo: 'segundos', complejo: 'reps con aguante' };

/**
 * @param state  { objetivos, ejercicios, entrenamientos, series }
 * @param opts   { desde: 'YYYY-MM-DD' | null, hasta: 'YYYY-MM-DD' | null, instrucciones: boolean }
 */
export function generarResumen(state, { desde = null, hasta = null, instrucciones = true } = {}) {
  const ejById = new Map(state.ejercicios.map((e) => [e.id, e]));
  const objById = new Map(state.objetivos.map((o) => [o.id, o]));
  const enRango = (f) => (!desde || f >= desde) && (!hasta || f <= hasta);
  const ents = state.entrenamientos.filter((e) => enRango(e.fecha)).sort((a, b) => a.fecha.localeCompare(b.fecha));

  const out = [];
  if (instrucciones) out.push(INSTRUCCIONES_IA, '', '---', '');
  out.push('# Registro de entrenamiento de calistenia', '');
  if (!ents.length) {
    out.push(desde || hasta ? 'No hay entrenos en este periodo.' : 'Todavía no hay entrenos registrados.');
    return out.join('\n');
  }
  out.push(`Periodo: ${ents[0].fecha} a ${ents[ents.length - 1].fecha} · ${ents.length} entreno${ents.length === 1 ? '' : 's'}`, '');
  out.push('Cómo leerlo: «8» = 8 repeticiones · «30 s» = aguante de 30 segundos · «8×10s» = 8 repeticiones con 10 s de aguante (o de bajada, en negativos) en cada una · «+5kg» = lastre · «−10kg banda» = asistencia. Solo se listan las series marcadas como hechas.', '');

  // ---- Bienestar ----
  const conEnergia = ents.filter((e) => e.energia != null);
  const sens = {};
  const mol = {};
  for (const e of ents) {
    if (e.sensacion) sens[e.sensacion] = (sens[e.sensacion] || 0) + 1;
    for (const m of e.molestias || []) (mol[m] ||= []).push(e.fecha);
  }
  const lineas = [];
  if (conEnergia.length) {
    const media = conEnergia.reduce((t, e) => t + e.energia, 0) / conEnergia.length;
    lineas.push(`- Energía media: ${num(media, 0)}/100 (${conEnergia.length} entreno${conEnergia.length === 1 ? '' : 's'} con dato; mín. ${Math.min(...conEnergia.map((e) => e.energia))}, máx. ${Math.max(...conEnergia.map((e) => e.energia))}).`);
  }
  const pesos = ents.filter((e) => e.peso_corporal > 0);
  if (pesos.length) lineas.push(`- Peso corporal: ${pesos.map((e) => `${num(e.peso_corporal)} kg (${e.fecha})`).join(' → ')}.`);
  if (Object.keys(sens).length) lineas.push(`- Sensaciones: ${Object.entries(sens).map(([k, n]) => `${k} (${n})`).join(', ')}.`);
  for (const [m, fechas] of Object.entries(mol).sort((a, b) => b[1].length - a[1].length)) {
    lineas.push(`- Molestia «${m}»: ${fechas.length} de ${ents.length} entrenos (última: ${fechaCompleta(fechas[fechas.length - 1])}).`);
  }
  if (lineas.length) out.push('## Bienestar', '', ...lineas, '');

  // ---- Reparto por zona (cada ejercicio cuenta solo en su zona principal) ----
  const tz = totalesZona(state, ents[0].fecha, ents[ents.length - 1].fecha);
  const totalSeries = [...tz.values()].reduce((t, z) => t + z.series, 0);
  if (totalSeries) {
    const ini = desde || ents[0].fecha, fin = hasta || ents[ents.length - 1].fecha;   // el periodo elegido, no solo el tramo con entrenos
    const semanas = Math.max(1, (parseISO(fin) - parseISO(ini) + 86400000) / 604800000);
    const zl = [...ZONAS.map((z) => z.k), 'sin'].filter((k) => tz.has(k)).map((k) => {
      const z = tz.get(k);
      const extra = [z.reps ? `${num(z.reps, 0)} reps` : '', z.segundos ? `${num(z.segundos, 0)} s de aguante` : '', z.kg ? `${num(z.kg, 0)} kg×rep de lastre` : ''].filter(Boolean).join(', ');
      return `- ${nombreZona(k)}: ${z.series} series (${Math.round((z.series / totalSeries) * 100)} %, ~${num(z.series / semanas, 1)}/semana) en ${z.entrenos} entreno${z.entrenos === 1 ? '' : 's'}${extra ? ` · ${extra}` : ''}`;
    });
    const faltan = ZONAS.filter((z) => !tz.has(z.k)).map((z) => z.n);
    if (faltan.length) zl.push(`- Sin trabajo en el periodo: ${faltan.join(', ')}.`);
    out.push('## Reparto por zona', '', 'Cada ejercicio cuenta solo en su zona principal.', '', ...zl, '');
  }

  // ---- Entrenos (cronológico) ----
  out.push('## Entrenos (del más antiguo al más reciente)', '');
  for (const ent of ents) {
    out.push(`### ${fechaCompleta(ent.fecha)}`);
    const meta = [];
    if (ent.energia != null) meta.push(`Energía: ${ent.energia}/100`);
    if (ent.sensacion) meta.push(`Sensación: ${ent.sensacion}`);
    if ((ent.molestias || []).length) meta.push(`Molestias: ${ent.molestias.join(', ')}`);
    if (ent.peso_corporal) meta.push(`Peso corporal: ${num(ent.peso_corporal)} kg`);
    if (meta.length) out.push(meta.join(' · '));
    if ((ent.notas || '').trim()) out.push(`Notas: ${ent.notas.trim().replace(/\s*\n\s*/g, ' / ')}`);
    for (const ejId of ent.ejercicios || []) {
      const ej = ejById.get(ejId); if (!ej) continue;
      const sets = state.series.filter((s) => s.entrenamiento_id === ent.id && s.ejercicio_id === ejId && serieHecha(s))
        .sort((a, b) => a.set_numero - b.set_numero);
      const obj = ej.objetivo_id && objById.get(ej.objetivo_id);
      out.push(`- ${ej.nombre}${obj ? ` [${obj.nombre}]` : ''}: ${sets.length ? sets.map((s) => textoSerie(s, ej.tipo, cargaDe(ej).asist)).join(', ') : '(sin series completadas)'}`);
    }
    out.push('');
  }

  // ---- Evolución por ejercicio (solo el periodo) ----
  const bloques = [];
  for (const ej of state.ejercicios) {
    const ses = sesionesDeEjercicio(state, ej.id).filter((s) => enRango(s.fecha));
    if (!ses.length) continue;
    const valores = ses.map((s) => s.max);
    const m = metricaPrincipal(ej, ses);
    const t = m === 'fuerza' ? tendencia(ses.map((s) => s.fuerza)) : tendencia(valores, ej.tipo === 'tiempo' ? { abs: 2 } : {});
    const c = cargaDe(ej);
    const fmt = (v) => (ej.tipo === 'tiempo' ? `${num(v, 0)} s` : `${num(v, 0)}`);
    const aguante = ej.tipo === 'complejo' ? ses.map((s) => s.aguante).filter((v) => v > 0) : [];
    const lastre = ses.map((s) => s.lastre);
    const obj = ej.objetivo_id && objById.get(ej.objetivo_id);
    const zn = zonaDe(ej);
    bloques.push(`- ${ej.nombre} (${UNIDAD[ej.tipo] || 'reps'}${c.f === 0 && ej.tipo !== 'tiempo' ? ', carga: solo kg' : ''}${zn ? `, zona ${nombreZona(zn)}` : ''}${obj ? `, objetivo ${obj.nombre}` : ''}): mejor serie por sesión ${valores.map(fmt).join(' → ')} · récord del periodo ${fmt(Math.max(...valores))} · tendencia ${tendTxt(t)}` +
      (aguante.length ? ` · aguante máx. por rep ${num(Math.max(...aguante), 0)} s` : '') +
      (lastre.some((v) => v > 0) ? ` · ${c.f === 0 ? 'carga' : 'lastre'} ${lastre.map((v) => num(v)).join(' → ')} kg` : '') +
      (c.asist && ses.some((s) => s.banda > 0) ? ` · banda (asistencia) ${ses.map((s) => num(s.banda)).join(' → ')} kg` : '') +
      (m === 'fuerza' ? ` · fuerza estimada ${ses.map((s) => num(s.fuerza, 0)).join(' → ')} kg (la tendencia se mide con esta)` : ''));
  }
  if (bloques.length) out.push('## Evolución por ejercicio', '', ...bloques, '');

  // ---- Objetivos (histórico completo) ----
  const objs = [];
  for (const o of state.objetivos) {
    const p = progresoObjetivo(state, o.id);
    if (!p.puntos.length) continue;
    objs.push(`- ${o.nombre}: índice ${num(p.puntos[0].y, 0)} → ${num(p.puntos[p.puntos.length - 1].y, 0)} (100 = primera marca de cada ejercicio, histórico completo) · ${tendTxt(p.tend)} · ejercicios: ${p.ejercicios.map((e) => e.nombre).join(', ')}`);
  }
  if (objs.length) out.push('## Objetivos', '', ...objs, '');

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

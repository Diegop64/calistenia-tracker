// Calisthenics Tracker — aplicación principal (vanilla JS, ES modules, sin build).
import * as DB from './db.js';
import { uid, hoy, addDays, fechaCorta, fechaLarga, fechaEtiqueta, gridMes, nombreMes, esc, num, fmtSeg, parseNum, debounce, isoDate } from './util.js';
import { METRICAS, sesionesDeEjercicio, sesionPrevia, resumenEjercicio, progresoObjetivo, valorMetrica, diasEntre, serieHecha } from './stats.js';
import { BIBLIOTECA, GRUPOS_INICIALES } from './biblioteca.js';
import { Sync, configurado as nubeConfigurada } from './sync.js';
import { lineChart, sparkline } from './chart.js';
import { generarResumen, SENSACIONES, MOLESTIAS } from './resumen.js';

/* ============================================================
   Estado
   ============================================================ */
const state = { objetivos: [], ejercicios: [], entrenamientos: [], series: [] };
const now = new Date();
const ui = {
  view: 'train',
  fecha: hoy(),
  hist: { y: now.getFullYear(), m: now.getMonth(), sel: null },
  stats: { tab: 'ejercicios', ejId: null, objId: null, metrica: 'max', sel: null },
  persist: { soportado: false, persistente: false },
  ultimaCopia: null,
  updateSW: null,
  crono: null,
  wakeLock: null,
  undo: null,
  ia: { dias: 28, instr: true },
  iaTxt: '',
};

const $ = (s, r = document) => r.querySelector(s);
const viewEl = $('#view');
const sheetRoot = $('#sheet-root');
const fabEl = $('#fab');
const byNombre = (a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });

const ejById = (id) => state.ejercicios.find((e) => e.id === id);
const objById = (id) => state.objetivos.find((o) => o.id === id);
const entDe = (fecha) => state.entrenamientos.find((e) => e.fecha === fecha);
const seriesDe = (entId, ejId) =>
  state.series.filter((s) => s.entrenamiento_id === entId && s.ejercicio_id === ejId).sort((a, b) => a.set_numero - b.set_numero);
const tieneSeries = (ejId) => state.series.some((s) => s.ejercicio_id === ejId);
const esInstalada = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* noop */ } };
const esPC = () => matchMedia('(min-width:1024px)').matches;
const punteroFino = () => matchMedia('(hover:hover) and (pointer:fine)').matches;

/* ============================================================
   Persistencia con cola (escritura diferida mientras se teclea)
   ============================================================ */
const pending = new Map();
function flush() {
  const by = {};
  for (const { store, obj } of pending.values()) (by[store] ||= []).push(obj);
  pending.clear();
  for (const [s, arr] of Object.entries(by)) DB.putMany(s, arr).catch(avisarErrorGuardado);
}
const flushSoon = debounce(flush, 250);
const queue = (store, obj) => { pending.set(`${store}:${obj.id}`, { store, obj }); flushSoon(); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);
function avisarErrorGuardado(e) { console.error(e); toast('⚠ No se pudo guardar. Revisa el espacio del iPhone.'); }

/* ============================================================
   Mutaciones de datos
   ============================================================ */
async function asegurarEntreno(fecha) {
  let ent = entDe(fecha);
  if (!ent) {
    ent = { id: uid(), fecha, notas: '', ejercicios: [] };
    state.entrenamientos.push(ent);
    await DB.put('entrenamientos', ent);
  }
  return ent;
}

async function addEjAlEntreno(ejId) {
  const ent = await asegurarEntreno(ui.fecha);
  if (ent.ejercicios.includes(ejId)) return;
  ent.ejercicios.push(ejId);
  const s = { id: uid(), entrenamiento_id: ent.id, ejercicio_id: ejId, set_numero: 1, valor: null, peso_extra: null, hecha: false };
  if (ejById(ejId)?.tipo === 'complejo') s.segundos = null;
  state.series.push(s);
  await DB.put('entrenamientos', ent);
  await DB.put('series', s);
}

async function addSerie(ejId) {
  const ent = entDe(ui.fecha); if (!ent) return;
  const prev = seriesDe(ent.id, ejId);
  const last = prev[prev.length - 1];
  const s = {
    id: uid(), entrenamiento_id: ent.id, ejercicio_id: ejId,
    set_numero: (last ? last.set_numero : 0) + 1,
    valor: last ? last.valor : null,           // copia la serie anterior: lo habitual es repetir
    peso_extra: last ? last.peso_extra : null,
    hecha: false,
  };
  if (ejById(ejId)?.tipo === 'complejo') s.segundos = last ? (last.segundos ?? null) : null;   // el aguante se repite como las reps
  state.series.push(s);
  await DB.put('series', s);
}

async function delSerie(id) {
  const s = state.series.find((x) => x.id === id); if (!s) return;
  flush();
  state.series = state.series.filter((x) => x.id !== id);
  const resto = seriesDe(s.entrenamiento_id, s.ejercicio_id);
  resto.forEach((x, i) => { x.set_numero = i + 1; });
  await DB.deleteWhere({ series: [id] });
  await DB.putMany('series', resto);
}

/** Un entreno sin ejercicios solo se conserva si guarda algo de «Cómo ha ido». */
const sinContenido = (ent) => !ent.ejercicios.length && !(ent.notas || '').trim() && ent.energia == null && !ent.sensacion && !(ent.molestias || []).length;

async function limpiarEntrenoVacio(ent) {
  if (sinContenido(ent)) {
    state.entrenamientos = state.entrenamientos.filter((e) => e.id !== ent.id);
    await DB.deleteWhere({ entrenamientos: [ent.id] });
  } else {
    await DB.put('entrenamientos', ent);
  }
}

async function quitarEjDelEntreno(ejId) {
  const ent = entDe(ui.fecha); if (!ent) return;
  flush();
  const ids = state.series.filter((s) => s.entrenamiento_id === ent.id && s.ejercicio_id === ejId).map((s) => s.id);
  state.series = state.series.filter((s) => !ids.includes(s.id));
  ent.ejercicios = ent.ejercicios.filter((id) => id !== ejId);
  await DB.deleteWhere({ series: ids });
  await limpiarEntrenoVacio(ent);
}

async function borrarEntreno(entId) {
  flush();
  const ids = state.series.filter((s) => s.entrenamiento_id === entId).map((s) => s.id);
  state.series = state.series.filter((s) => s.entrenamiento_id !== entId);
  state.entrenamientos = state.entrenamientos.filter((e) => e.id !== entId);
  await DB.deleteWhere({ series: ids, entrenamientos: [entId] });
}

async function crearObjetivo(nombre) {
  const o = { id: uid(), nombre };
  state.objetivos.push(o);
  await DB.put('objetivos', o);
  return o;
}

async function borrarEjercicio(ejId) {
  flush();
  const sIds = state.series.filter((s) => s.ejercicio_id === ejId).map((s) => s.id);
  state.series = state.series.filter((s) => s.ejercicio_id !== ejId);
  state.ejercicios = state.ejercicios.filter((e) => e.id !== ejId);
  const tocados = [];
  const huerfanos = [];
  for (const ent of state.entrenamientos) {
    if (ent.ejercicios.includes(ejId)) {
      ent.ejercicios = ent.ejercicios.filter((id) => id !== ejId);
      if (sinContenido(ent)) huerfanos.push(ent.id); else tocados.push(ent);
    }
  }
  state.entrenamientos = state.entrenamientos.filter((e) => !huerfanos.includes(e.id));
  await DB.deleteWhere({ series: sIds, ejercicios: [ejId], entrenamientos: huerfanos });
  await DB.putMany('entrenamientos', tocados);
}

async function borrarObjetivo(objId) {
  const tocados = state.ejercicios.filter((e) => e.objetivo_id === objId);
  tocados.forEach((e) => { e.objetivo_id = null; });
  state.objetivos = state.objetivos.filter((o) => o.id !== objId);
  await DB.deleteWhere({ objetivos: [objId] });
  await DB.putMany('ejercicios', tocados);
}

/** Garantiza que cada entrenamiento tenga la lista `ejercicios` (por si viene de una copia antigua). */
async function normalizar() {
  const cambiados = [];
  for (const ent of state.entrenamientos) {
    const desdeSeries = [...new Set(state.series.filter((s) => s.entrenamiento_id === ent.id)
      .sort((a, b) => a.set_numero - b.set_numero).map((s) => s.ejercicio_id))];
    if (!Array.isArray(ent.ejercicios)) { ent.ejercicios = desdeSeries; cambiados.push(ent); }
    else {
      const faltan = desdeSeries.filter((id) => !ent.ejercicios.includes(id));
      if (faltan.length) { ent.ejercicios.push(...faltan); cambiados.push(ent); }
    }
    if (typeof ent.notas !== 'string') { ent.notas = ''; if (!cambiados.includes(ent)) cambiados.push(ent); }
  }
  await DB.putMany('entrenamientos', cambiados);
}

/* ---------- Deshacer: instantánea completa antes de una operación destructiva ---------- */
const clonar = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
async function conDeshacer(msg, fn) {
  flush();
  const snap = clonar({ objetivos: state.objetivos, ejercicios: state.ejercicios, entrenamientos: state.entrenamientos, series: state.series });
  await fn();
  ui.undo = { snap, n: DB.escrituras() };
  toast(msg, { action: 'deshacer', label: 'Deshacer' });
}
async function deshacer() {
  const u = ui.undo; ui.undo = null;
  if (!u) return;
  // Si hubo cualquier cambio después del borrado, restaurar la instantánea pisaría datos nuevos.
  if (pending.size || DB.escrituras() !== u.n) { toast('Ya no se puede deshacer'); return; }
  await DB.replaceAll(u.snap);
  Object.assign(state, u.snap);
  render(); toast('Deshecho');
}

/* ============================================================
   Pequeños componentes de UI
   ============================================================ */
const svg = (d, cls = 'ico') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${d}</svg>`;
const I = {
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>'),
  more: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  timer: svg('<circle cx="12" cy="13.5" r="7"/><path d="M12 10v4M9.5 3h5"/>'),
  ia: svg('<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
};

const hdr = (eyebrow, titulo, sub = '', right = '') => `
  <header class="flex items-end justify-between gap-3 mb-4">
    <div class="min-w-0">
      <p class="text-xs uppercase tracking-widest text-mute font-semibold">${eyebrow}</p>
      <h1 class="text-3xl font-extrabold tracking-tight truncate">${titulo}</h1>
      ${sub ? `<p class="text-sm text-mute mt-0.5">${sub}</p>` : ''}
    </div>
    <div class="flex gap-2 shrink-0">${right}</div>
  </header>`;

function badge(t, conPct = true) {
  const m = {
    up: ['▲', 'Mejorando', 'text-accent bg-accent/10'],
    flat: ['■', 'Estancado', 'text-warn bg-warn/10'],
    down: ['▼', 'Bajando', 'text-bad bg-bad/10'],
    na: ['•', 'Pocos datos', 'text-mute bg-raise'],
  }[t.estado];
  const pct = conPct && t.pct != null ? ` ${t.pct > 0 ? '+' : ''}${num(t.pct, 0)}%` : '';
  return `<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${m[2]}">${m[0]} ${m[1]}${pct}</span>`;
}

const chip = (txt) => `<span class="chip">${esc(txt)}</span>`;
const fmtV = (v, tipo) => `${num(v, 0)}${tipo === 'tiempo' ? ' s' : ''}`;
const fmtMetrica = (v, ej, m) => (m === 'lastre' ? `${num(v)} kg` : m === 'aguante' ? `${num(v, 0)} s` : ej.tipo === 'tiempo' ? fmtSeg(v) : `${num(v, 0)} reps`);
const tipoTxt = (t) => (t === 'tiempo' ? 'Tiempo' : t === 'complejo' ? 'Complejo' : 'Repeticiones');
/** Una serie en texto: «8» · «30 s» · «8×10s» (complejo: reps × aguante por rep), más «+5kg» si lleva lastre. */
const fmtSerie = (s, tipo) => fmtV(s.valor, tipo) + (tipo === 'complejo' && s.segundos ? `×${num(s.segundos, 0)}s` : '') + (s.peso_extra ? `+${num(s.peso_extra)}kg` : '');

function deltaTxt(d, unidad) {
  if (d > 0) return `<span class="text-accent font-semibold">▲ +${num(d, d % 1 ? 1 : 0)} ${unidad}</span>`;
  if (d < 0) return `<span class="text-bad font-semibold">▼ −${num(-d, -d % 1 ? 1 : 0)} ${unidad}</span>`;
  return `<span class="text-mute">= igual</span>`;
}

let toastTimer;
function toast(msg, accion = null) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${accion ? `<button class="toast-btn" data-action="${accion.action}">${esc(accion.label)}</button>` : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), accion ? 8000 : 2600);
}

/* ---------- Hojas modales (bottom sheets) ---------- */
let sheetOnClose = null;
let sheetCtx = null;
function abrirSheet(html, { onClose = null, ctx = null } = {}) {
  sheetOnClose = onClose; sheetCtx = ctx;
  sheetRoot.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
  document.body.classList.add('sheet-open');
  if (punteroFino()) sheetRoot.querySelector('[data-field="buscar"], input[name="nombre"], input[name="email"]')?.focus();
}
function cerrarSheet({ silencioso = false } = {}) {
  const cb = sheetOnClose;
  sheetOnClose = null; sheetCtx = null;
  sheetRoot.innerHTML = '';
  document.body.classList.remove('sheet-open');
  if (cb && !silencioso) cb();
}
let confirmRes = null;
function confirmar({ titulo, texto = '', ok = 'Confirmar', peligro = false }) {
  return new Promise((res) => {
    confirmRes = res;
    abrirSheet(`
      <h2 class="text-xl font-bold mb-1">${esc(titulo)}</h2>
      <p class="text-mute mb-5">${esc(texto)}</p>
      <div class="grid gap-2">
        <button data-action="confirm-ok" class="${peligro ? 'btn-danger' : 'btn-primary'}">${esc(ok)}</button>
        <button data-action="close-sheet" class="btn-ghost">Cancelar</button>
      </div>`, { onClose: () => { const r = confirmRes; confirmRes = null; if (r) r(false); } });
  });
}

/* ============================================================
   Render principal
   ============================================================ */
function render({ top = false } = {}) {
  const y = window.scrollY;
  const yLista = document.querySelector('.pc-scroll')?.scrollTop || 0;
  let html = '';
  if (ui.view === 'train') html = renderTrain();
  else if (ui.view === 'history') html = renderHistory();
  else html = renderStats();
  viewEl.innerHTML = html;
  viewEl.classList.toggle('has-fab', ui.view === 'train');
  fabEl.classList.toggle('hidden', ui.view !== 'train');
  document.querySelectorAll('.nav-btn').forEach((b) => {
    if (b.dataset.nav === ui.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  window.scrollTo(0, top ? 0 : y);
  const lista = document.querySelector('.pc-scroll'); if (lista && !top) lista.scrollTop = yLista;
  pintarNavNube();
  if (ui.view === 'train') aplicarCrono();
}

/* ============================================================
   Vista: ENTRENAR
   ============================================================ */
function necesitaCopia() {
  if (!state.entrenamientos.length) return false;
  if (!ui.ultimaCopia) return state.entrenamientos.length >= 3;
  return diasEntre(isoDate(new Date(ui.ultimaCopia)), hoy()) >= 14;
}

function avisos() {
  const out = [];
  if (ui.updateSW) {
    out.push(`<div class="note border-accent/40">
      <p class="font-semibold">Hay una versión nueva</p>
      <button data-action="actualizar-app" class="btn-mini mt-2">Actualizar ahora</button></div>`);
  }
  if (!esPC() && !esInstalada() && lsGet('ct-instala-ok') !== '1') {
    out.push(`<div class="note">
      <p class="font-semibold">Instálala antes de empezar</p>
      <p class="text-mute text-sm mt-1">En Safari: <b class="text-ink">Compartir ⎋ → Añadir a pantalla de inicio</b>. Los datos de Safari y los de la app instalada son independientes, y Safari puede borrar los suyos tras 7 días sin uso. Instala primero y registra después.</p>
      <button data-action="cerrar-instala" class="btn-mini mt-2">Entendido</button></div>`);
  }
  if (nubeConfigurada && !Sync.estado.usuario && lsGet('ct-nube-ok') !== '1') {
    out.push(`<div class="note">
      <p class="font-semibold">Activa la copia en la nube</p>
      <p class="text-mute text-sm mt-1">Inicia sesión con tu cuenta de Firebase para sincronizar y proteger tus entrenos.</p>
      <div class="flex gap-2 mt-2"><button data-action="ajustes" class="btn-mini">Iniciar sesión</button>
      <button data-action="cerrar-nube" class="btn-mini">Más tarde</button></div></div>`);
  }
  if (necesitaCopia()) {
    out.push(`<div class="note border-warn/40">
      <p class="font-semibold">Haz una copia de seguridad</p>
      <p class="text-mute text-sm mt-1">${ui.ultimaCopia ? 'Hace más de 2 semanas de la última.' : 'Todavía no has guardado ninguna.'} Guárdala en Archivos / iCloud Drive.</p>
      <button data-action="ajustes" class="btn-mini mt-2">Abrir copias</button></div>`);
  }
  return out[0] || '';   // solo el más prioritario: los avisos no deben tapar tu entreno
}

function resumenTxt(ent) {
  if (!ent) return '';
  const val = state.series.filter((s) => s.entrenamiento_id === ent.id && serieHecha(s)).length;
  return `${ent.ejercicios.length} ejercicio${ent.ejercicios.length === 1 ? '' : 's'} · ${val} serie${val === 1 ? '' : 's'} ${val === 1 ? 'hecha' : 'hechas'}`;
}
function refreshResumen() {
  const el = $('#resumen'); if (el) el.textContent = resumenTxt(entDe(ui.fecha));
}

function renderTrain() {
  const ent = entDe(ui.fecha);
  const esHoy = ui.fecha === hoy();
  const nav = `
    <button data-action="dia" data-d="-1" class="icon-btn" aria-label="Día anterior">${I.back}</button>
    ${esHoy ? '' : `<button data-action="dia-hoy" class="icon-btn px-3 w-auto text-sm font-semibold">Hoy</button>`}
    <button data-action="dia" data-d="1" class="icon-btn" aria-label="Día siguiente">${I.next}</button>`;
  const titulo = `<label class="relative block">${esc(fechaEtiqueta(ui.fecha))}
      <input type="date" value="${ui.fecha}" data-field="fecha" class="absolute inset-0 opacity-0 w-full h-full" aria-label="Elegir fecha"></label>`;

  const anadir = `<button data-action="picker" class="btn-primary pc-only !h-11 !px-4">＋ Añadir ejercicio</button>`;
  let cards, resumen = '', notas = '';
  if (ent && ent.ejercicios.length) {
    resumen = `<p id="resumen" class="train-resumen text-sm text-mute mb-3">${resumenTxt(ent)}</p>`;
    cards = `<div class="train-cards">${ent.ejercicios.map((id) => cardEjercicio(ent, id)).join('')}</div>`;
    notas = checkinHTML(ent);
  } else {
    cards = `<div class="card text-center py-10 mt-2">
      <p class="font-semibold text-lg">Sin ejercicios todavía</p>
      <p class="text-mute text-sm mt-1 mb-4">Pulsa “Añadir ejercicio” para empezar a registrar.</p></div>`;
  }
  return hdr('Entrenar', titulo, esHoy ? esc(fechaLarga(ui.fecha)) : '', anadir + nav) +
    `<div class="train-grid"><div class="train-main">${cards}</div>
      <aside class="train-side"><div class="train-avisos">${avisos()}</div>${resumen}${notas}</aside></div>`;
}

/** «Cómo ha ido»: energía 0-100, sensación, molestias y notas libres. Se guarda en el propio entreno. */
function checkinHTML(ent) {
  const en = ent.energia;
  const tags = (lista, accion, marcados) => lista.map((v) =>
    `<button type="button" class="tag" data-action="${accion}" data-v="${esc(v)}" aria-pressed="${marcados(v)}">${esc(v)}</button>`).join('');
  const mol = new Set(ent.molestias || []);
  return `<section class="train-notas card mt-4" aria-label="Cómo ha ido el entreno">
    <h2 class="font-bold text-lg mb-3">Cómo ha ido</h2>
    <div class="mb-3">
      <div class="flex items-baseline justify-between gap-2"><span class="lbl !mb-0">Energía</span>
        <span class="flex items-baseline gap-3"><button type="button" data-action="energia-clear" class="text-xs text-mute underline ${en == null ? 'hidden' : ''}">Quitar</button>
        <span id="energia-val" class="text-sm font-bold tabular-nums">${en == null ? 'Sin indicar' : en + ' / 100'}</span></span></div>
      <input type="range" min="0" max="100" step="5" value="${en ?? 50}" data-field="energia" class="range ${en == null ? 'unset' : ''}" aria-label="Energía de 0 a 100">
    </div>
    <div class="mb-4"><span class="lbl">Sensación</span><div class="flex flex-wrap gap-2">${tags(SENSACIONES, 'sens', (v) => ent.sensacion === v)}</div></div>
    <div class="mb-4"><span class="lbl">Molestias o dolor</span><div class="flex flex-wrap gap-2">${tags(MOLESTIAS, 'molestia', (v) => mol.has(v))}</div></div>
    <label class="block"><span class="lbl">Notas</span>
      <textarea data-field="notas" rows="3" class="inp inp-text h-auto py-3 resize-none" placeholder="Ej. dolor leve en el hombro derecho al bajar en la pica; dormí poco…">${esc(ent.notas || '')}</textarea></label>
  </section>`;
}

function cardEjercicio(ent, ejId) {
  const ej = ejById(ejId); if (!ej) return '';
  const obj = ej.objetivo_id && objById(ej.objetivo_id);
  const sets = seriesDe(ent.id, ejId);
  const prev = sesionPrevia(state, ejId, ui.fecha);
  const esT = ej.tipo === 'tiempo', esC = ej.tipo === 'complejo';
  const prevTxt = prev
    ? `Última vez · ${fechaCorta(prev.fecha)}: <b class="text-ink font-semibold">${prev.sets.map((s) => fmtSerie(s, ej.tipo)).join(' · ')}</b>`
    : 'Primera vez con este ejercicio';

  const filas = sets.map((s, i) => {
    const p = prev && prev.sets[i];
    const ok = serieHecha(s);
    return `<div class="set-row ${esC ? 'cx' : ''} ${ok ? 'done' : ''}" data-serie="${s.id}">
      <span class="set-n">${i + 1}</span>
      <div class="relative">
        <input class="inp ${esT ? 'pr-12' : ''}" data-field="valor" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off"
               aria-label="Serie ${i + 1}: ${esT ? 'segundos' : 'repeticiones'}" placeholder="${p ? num(p.valor, 0) : '0'}" value="${s.valor ?? ''}">
        ${esT ? `<button type="button" class="crono-btn" data-action="crono" aria-label="Iniciar cronómetro">${I.timer}</button>` : ''}
      </div>
      ${esC ? `<input class="inp" data-field="seg" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off"
             aria-label="Serie ${i + 1}: segundos de aguante por repetición" placeholder="${p && p.segundos ? num(p.segundos, 0) : '0'}" value="${s.segundos ?? ''}">` : ''}
      <input class="inp" data-field="peso" inputmode="decimal" enterkeyhint="done" autocomplete="off"
             aria-label="Serie ${i + 1}: peso extra en kg" placeholder="${p && p.peso_extra ? num(p.peso_extra) : '0'}" value="${s.peso_extra ?? ''}">
      <button class="check-btn" data-action="check-serie" aria-pressed="${ok}" aria-label="${ok ? 'Desmarcar' : 'Marcar como hecha la'} serie ${i + 1}">${I.check}</button>
      <button class="del-btn" data-action="del-serie" aria-label="Eliminar serie ${i + 1}">${I.x}</button>
    </div>`;
  }).join('');

  return `<section class="card" data-ej="${ej.id}">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="text-lg font-bold leading-tight">${esc(ej.nombre)}</h2>
        <div class="flex flex-wrap gap-1.5 mt-1">${obj ? chip(obj.nombre) : ''}${chip(tipoTxt(ej.tipo))}</div>
      </div>
      <button class="icon-btn shrink-0" data-action="menu-ej" aria-label="Más opciones">${I.more}</button>
    </div>
    <p class="text-sm text-mute mt-2 mb-3">${prevTxt}</p>
    <div class="set-row ${esC ? 'cx' : ''} text-[11px] font-semibold tracking-wider text-mute uppercase mb-1">
      <span class="text-center">Nº</span><span class="text-center">${esT ? 'Segundos' : 'Reps'}</span>${esC ? '<span class="text-center">Seg</span>' : ''}<span class="text-center">+ Kg</span><span class="text-center">✓</span><span></span>
    </div>
    <div class="space-y-2">${filas}</div>
    <button class="btn-ghost w-full mt-3" data-action="add-serie">＋ Añadir serie</button>
  </section>`;
}

/** Actualiza el aspecto de una fila (hecha / pendiente) sin re-renderizar toda la vista. */
function pintarFila(row, s) {
  if (!row || !s) return;
  const ok = serieHecha(s);
  row.classList.toggle('done', ok);
  const cb = row.querySelector('.check-btn');
  if (cb) {
    cb.setAttribute('aria-pressed', String(ok));
    const n = row.querySelector('.set-n')?.textContent || '';
    cb.setAttribute('aria-label', `${ok ? 'Desmarcar' : 'Marcar como hecha la'} serie ${n}`);
  }
}

/* ---------- Cronómetro para isométricos ---------- */
function aplicarCrono() {
  const c = ui.crono; if (!c) return;
  const row = document.querySelector(`[data-serie="${c.id}"]`); if (!row) return;
  row.querySelector('[data-field="valor"]').value = Math.floor((Date.now() - c.t0) / 1000);
  const cb = row.querySelector('.crono-btn');
  if (cb) { cb.classList.add('running'); cb.setAttribute('aria-label', 'Parar cronómetro'); }
}
async function toggleCrono(id) {
  if (ui.crono && ui.crono.id === id) return pararCrono();
  if (ui.crono) pararCrono();
  ui.crono = { id, t0: Date.now(), timer: setInterval(aplicarCrono, 250) };
  try { ui.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* opcional */ }
  aplicarCrono();
}
function pararCrono() {
  const c = ui.crono; if (!c) return;
  clearInterval(c.timer); ui.crono = null;
  try { ui.wakeLock?.release(); } catch { /* noop */ }
  ui.wakeLock = null;
  const secs = Math.max(1, Math.round((Date.now() - c.t0) / 1000));
  const s = state.series.find((x) => x.id === c.id);
  if (s) { s.valor = secs; s.hecha = true; queue('series', s); }
  const row = document.querySelector(`[data-serie="${c.id}"]`);
  if (row) { row.querySelector('[data-field="valor"]').value = secs; const cb = row.querySelector('.crono-btn'); cb?.classList.remove('running'); cb?.setAttribute('aria-label', 'Iniciar cronómetro'); pintarFila(row, s); }
  refreshResumen();
}

/* ============================================================
   Selector de ejercicios + formularios
   ============================================================ */
function pickerItems(q = '') {
  const ent = entDe(ui.fecha);
  const lista = state.ejercicios
    .filter((e) => e.nombre.toLowerCase().includes(q.trim().toLowerCase()))
    .sort(byNombre);
  if (!lista.length) return state.ejercicios.length ? '<p class="text-mute text-center py-6">Ningún ejercicio coincide.</p>'
      : '<div class="text-center py-6"><p class="text-mute mb-3">Aún no tienes ejercicios.</p><button class="btn-ghost w-full" data-action="biblioteca">Abrir biblioteca de ejercicios</button></div>';
  return lista.map((e) => {
    const dentro = ent && ent.ejercicios.includes(e.id);
    const obj = e.objetivo_id && objById(e.objetivo_id);
    return `<button class="pick-row" data-action="pick-ej" data-id="${e.id}" ${dentro ? 'disabled' : ''}>
      <span class="min-w-0 text-left"><span class="block font-semibold truncate">${esc(e.nombre)}</span>
      <span class="block text-xs text-mute">${obj ? esc(obj.nombre) + ' · ' : ''}${tipoTxt(e.tipo)}</span></span>
      <span class="text-sm ${dentro ? 'text-accent' : 'text-mute'}">${dentro ? '✓ Añadido' : 'Añadir'}</span></button>`;
  }).join('');
}

function sheetPicker() {
  abrirSheet(`
    <div class="flex items-center justify-between mb-3"><h2 class="text-xl font-bold">Añadir ejercicio</h2>
      <button class="btn-mini" data-action="nuevo-ej-entreno">＋ Nuevo</button></div>
    <input data-field="buscar" type="search" class="inp inp-text mb-3" placeholder="Buscar…" autocomplete="off">
    <div id="picker-list" class="space-y-1.5">${pickerItems()}</div>`);
}

function sheetEjercicio(ejId = null, { anadir = false } = {}) {
  const ej = ejId ? ejById(ejId) : null;
  const bloquea = !!(ej && tieneSeries(ej.id));
  const tipo = ej?.tipo || 'reps';
  const objs = [...state.objetivos].sort(byNombre);
  abrirSheet(`<form data-form="ejercicio" class="space-y-4" autocomplete="off">
    <h2 class="text-xl font-bold">${ej ? 'Editar ejercicio' : 'Nuevo ejercicio'}</h2>
    <label class="block"><span class="lbl">Nombre</span>
      <input name="nombre" required maxlength="60" class="inp inp-text" placeholder="Ej. Pike push-ups" value="${esc(ej?.nombre || '')}"></label>
    <div><span class="lbl">Tipo de medición</span>
      <div class="seg3">
        <label><input type="radio" name="tipo" value="reps" class="peer sr-only" ${tipo === 'reps' ? 'checked' : ''} ${bloquea ? 'disabled' : ''}>
          <span class="seg-btn peer-checked:bg-accent peer-checked:text-accent-ink">Reps</span></label>
        <label><input type="radio" name="tipo" value="tiempo" class="peer sr-only" ${tipo === 'tiempo' ? 'checked' : ''} ${bloquea ? 'disabled' : ''}>
          <span class="seg-btn peer-checked:bg-accent peer-checked:text-accent-ink">Tiempo</span></label>
        <label><input type="radio" name="tipo" value="complejo" class="peer sr-only" ${tipo === 'complejo' ? 'checked' : ''} ${bloquea ? 'disabled' : ''}>
          <span class="seg-btn peer-checked:bg-accent peer-checked:text-accent-ink">Complejo</span></label>
      </div>
      <p class="text-xs text-mute mt-1.5"><b class="text-ink font-semibold">Reps</b>: repeticiones. <b class="text-ink font-semibold">Tiempo</b>: aguantes (isométricos). <b class="text-ink font-semibold">Complejo</b>: cada serie guarda las reps y los segundos que aguantas en cada una (ej. flexión en pica sobre una pelota, 10 s). La gráfica cuenta las repeticiones.</p>
      ${bloquea ? '<p class="text-xs text-mute mt-1.5">El tipo no se puede cambiar: ya tiene series registradas.</p>' : ''}
    </div>
    <label class="block"><span class="lbl">Objetivo / categoría</span>
      <select name="objetivo" class="inp inp-text">
        <option value="">Sin objetivo</option>
        ${objs.map((o) => `<option value="${o.id}" ${ej?.objetivo_id === o.id ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}
        <option value="__nuevo">＋ Crear objetivo nuevo…</option>
      </select></label>
    <input name="objetivo_nuevo" maxlength="60" class="inp inp-text hidden" placeholder="Nombre del objetivo (ej. Press a pino)">
    <div class="grid gap-2 pt-1">
      <button class="btn-primary" type="submit">${ej ? 'Guardar cambios' : (anadir ? 'Crear y añadir al entreno' : 'Crear ejercicio')}</button>
      ${ej ? '<button type="button" class="btn-danger" data-action="borrar-ej">Eliminar ejercicio</button>' : ''}
      <button type="button" class="btn-ghost" data-action="close-sheet">Cancelar</button>
    </div></form>`, { ctx: { ejId, anadir, bloquea, tipoActual: tipo } });
}

function sheetObjetivo(objId = null) {
  const o = objId ? objById(objId) : null;
  const ejs = [...state.ejercicios].sort(byNombre);
  abrirSheet(`<form data-form="objetivo" class="space-y-4" autocomplete="off">
    <h2 class="text-xl font-bold">${o ? 'Editar objetivo' : 'Nuevo objetivo'}</h2>
    <label class="block"><span class="lbl">Nombre</span>
      <input name="nombre" required maxlength="60" class="inp inp-text" placeholder="Ej. Press a pino" value="${esc(o?.nombre || '')}"></label>
    <div><span class="lbl">Ejercicios que lo componen</span>
      ${ejs.length ? `<div class="space-y-1.5">${ejs.map((e) => {
        const otro = e.objetivo_id && e.objetivo_id !== objId ? objById(e.objetivo_id) : null;
        return `<label class="check-row"><input type="checkbox" name="ej" value="${e.id}" class="sr-only peer" ${o && e.objetivo_id === o.id ? 'checked' : ''}>
          <span class="check-box peer-checked:bg-accent peer-checked:border-accent">✓</span>
          <span class="min-w-0 flex-1"><span class="block font-semibold truncate">${esc(e.nombre)}</span>
          ${otro ? `<span class="block text-xs text-mute">Ahora en: ${esc(otro.nombre)} (se moverá)</span>` : ''}</span></label>`;
      }).join('')}</div>` : '<p class="text-sm text-mute">Crea primero algún ejercicio; luego podrás agruparlos aquí.</p>'}
    </div>
    <div class="grid gap-2 pt-1">
      <button class="btn-primary" type="submit">${o ? 'Guardar cambios' : 'Crear objetivo'}</button>
      ${o ? '<button type="button" class="btn-danger" data-action="borrar-obj">Eliminar objetivo</button>' : ''}
      <button type="button" class="btn-ghost" data-action="close-sheet">Cancelar</button>
    </div></form>`, { ctx: { objId } });
}

/* ---------- Nube ---------- */
const haceTxt = (ts) => {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'hace un momento' : m < 60 ? `hace ${m} min` : `a las ${new Date(ts).toTimeString().slice(0, 5)}`;
};
function htmlNube() {
  const e = Sync.estado;
  if (!nubeConfigurada) return '<p class="text-sm text-mute">Sin configurar: falta pegar tu configuración de Firebase en <b class="text-ink">js/firebase-config.js</b>.</p>';
  if (!e.usuario) {
    return `<form data-form="login" class="space-y-2" autocomplete="on">
      <input name="email" type="email" required autocomplete="username" inputmode="email" autocapitalize="off" autocorrect="off" class="inp inp-text" placeholder="Email">
      <input name="password" type="password" required autocomplete="current-password" class="inp inp-text" placeholder="Contraseña">
      <p id="nube-error" class="text-sm text-bad min-h-[1.25rem]">${esc(e.error || '')}</p>
      <button class="btn-primary w-full" type="submit">Iniciar sesión</button></form>`;
  }
  const estado = {
    sincronizando: 'Sincronizando…', ok: `Sincronizado ${haceTxt(e.ultima)}`, listo: 'Conectado',
    offline: 'Sin conexión: se sincronizará al volver', error: `Error: ${e.error || ''}`,
  }[e.fase] || '';
  const color = e.fase === 'ok' ? 'text-accent' : e.fase === 'error' ? 'text-bad' : 'text-warn';
  return `<div class="flex justify-between gap-3 py-1.5"><span class="text-mute">Cuenta</span><span class="font-semibold truncate">${esc(e.usuario.email || '')}</span></div>
    <div class="flex justify-between gap-3 py-1.5"><span class="text-mute">Estado</span><span class="font-semibold text-right ${color}">${esc(estado)}</span></div>
    <div class="grid grid-cols-2 gap-2 mt-2">
      <button class="btn-ghost" data-action="nube-sync">Sincronizar ahora</button>
      <button class="btn-ghost" data-action="nube-logout">Cerrar sesión</button></div>`;
}
/** Texto y color del estado de la nube. */
function nubeEstado() {
  const e = Sync.estado;
  return !e.usuario ? ['☁ Sin sesión · iniciar', 'text-warn']
    : e.fase === 'ok' ? [`☁ Sincronizado ${haceTxt(e.ultima)}`, 'text-accent']
    : e.fase === 'sincronizando' ? ['☁ Sincronizando…', 'text-mute']
    : e.fase === 'error' ? ['☁ Error de sincronización · ver', 'text-bad']
    : e.fase === 'offline' ? ['☁ Sin conexión', 'text-warn'] : ['☁ Conectado', 'text-mute'];
}
/** Estado de la nube bajo el título de Progreso (móvil); al tocarlo abre el login/ajustes. */
function nubeChip() {
  if (!nubeConfigurada) return '';
  const [txt, cls] = nubeEstado();
  return `<button data-action="ajustes" class="mob-only font-semibold text-left ${cls}">${esc(txt)}</button>`;
}
function pintarNavNube() {
  const el = $('#nav-nube'); if (!el) return;
  el.textContent = nubeConfigurada ? nubeEstado()[0] : '';
}
function pintarNube() { const box = $('#nube-box'); if (box) box.innerHTML = htmlNube(); pintarNavNube(); }

/** La nube ha cambiado datos: los volcamos a IndexedDB y a memoria sin que eso dispare otra sincronización. */
async function aplicarEstadoRemoto(nuevo) {
  DB.silenciar(true);
  try {
    await DB.replaceAll(nuevo);
    Object.assign(state, nuevo);
    await normalizar();
  } finally { DB.silenciar(false); }
  ui.undo = null;
  if (!document.activeElement || !document.activeElement.matches('input,textarea,select')) render();
}

/** Texto listo para pegar en una IA con tus entrenos, energía, sensaciones, molestias y notas. */
function sheetResumenIA() {
  const o = ui.ia;
  const desde = o.dias ? addDays(hoy(), -o.dias + 1) : null;
  ui.iaTxt = generarResumen(state, { desde, hasta: hoy(), instrucciones: o.instr });
  const n = state.entrenamientos.filter((e) => (!desde || e.fecha >= desde) && e.fecha <= hoy()).length;
  const per = (d, t) => `<button class="seg-btn" aria-pressed="${o.dias === d}" data-action="ia-periodo" data-d="${d}">${t}</button>`;
  abrirSheet(`<h2 class="text-xl font-bold mb-1">Resumen para tu IA</h2>
    <p class="text-sm text-mute mb-3">Copia este texto y pégalo en la IA que uses (ChatGPT, Claude…). Incluye tus entrenos, energía, sensaciones, molestias y notas.</p>
    <div class="seg3 mb-2" role="group" aria-label="Periodo">${per(28, '4 semanas')}${per(84, '12 semanas')}${per(0, 'Todo')}</div>
    <button type="button" class="check-row w-full text-left mb-2" data-action="ia-instr" aria-pressed="${o.instr}">
      <span class="check-box ${o.instr ? '!bg-accent !border-accent !text-accent-ink' : ''}" style="${o.instr ? 'color:#0a0a0c' : ''}">✓</span>
      <span class="min-w-0 flex-1"><span class="block font-semibold">Incluir instrucciones para la IA</span>
      <span class="block text-xs text-mute">Le pide un análisis y ajustes concretos del entrenamiento.</span></span></button>
    <pre id="ia-txt" class="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-raise p-3 text-xs leading-relaxed text-ink" tabindex="0">${esc(ui.iaTxt)}</pre>
    <p class="text-xs text-mute mt-1.5">${n} entreno${n === 1 ? '' : 's'} · ${ui.iaTxt.length.toLocaleString('es')} caracteres</p>
    <div class="grid gap-2 mt-3">
      <button class="btn-primary" data-action="ia-copiar">Copiar texto</button>
      ${navigator.share ? '<button class="btn-ghost" data-action="ia-compartir">Compartir…</button>' : ''}
      <button class="btn-ghost" data-action="close-sheet">Cerrar</button></div>`);
}

async function copiarTexto(txt) {
  try { await navigator.clipboard.writeText(txt); return true; } catch { /* sin permiso: probamos el método antiguo */ }
  const ta = Object.assign(document.createElement('textarea'), { value: txt });
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0'; document.body.appendChild(ta);
  ta.focus(); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* noop */ }
  ta.remove(); return ok;
}

function sheetAjustes() {
  const nSer = state.series.filter((s) => serieHecha(s)).length;
  const fila = (k, v, ok) => `<div class="flex justify-between gap-3 py-2 border-b border-line last:border-0">
    <span class="text-mute">${k}</span><span class="font-semibold text-right ${ok === true ? 'text-accent' : ok === false ? 'text-warn' : ''}">${v}</span></div>`;
  abrirSheet(`
    <h2 class="text-xl font-bold mb-1">Datos y copias de seguridad</h2>
    <p class="text-sm text-mute mb-3">Tus datos viven solo en este iPhone, dentro de la app. No hay servidor ni cuenta.</p>
    <div class="card !p-3 mb-3">
      ${fila('Entrenos / series', `${state.entrenamientos.length} / ${nSer}`)}
      ${fila('App instalada', esInstalada() ? 'Sí' : 'No (instálala)', esInstalada())}
      ${fila('Protección de datos', ui.persist.persistente ? 'Activa' : 'No concedida', ui.persist.persistente)}
      ${fila('Última copia', ui.ultimaCopia ? fechaCorta(isoDate(new Date(ui.ultimaCopia))) + ' ' + new Date(ui.ultimaCopia).getFullYear() : 'Nunca', !!ui.ultimaCopia)}
    </div>
    <h3 class="text-sm uppercase tracking-widest text-mute font-semibold mb-2">Nube (Firebase)</h3>
    <div id="nube-box" class="card !p-3 mb-4">${htmlNube()}</div>
    <div class="grid gap-2">
      <button class="btn-primary" data-action="resumen-ia">Resumen para tu IA</button>
      <button class="btn-ghost" data-action="exportar">Exportar copia (.json)</button>
      <button class="btn-ghost" data-action="importar">Importar copia…</button>
      <button class="btn-ghost" data-action="buscar-update">Buscar actualización</button>
      <button class="btn-danger" data-action="borrar-todo">Eliminar todos los datos</button>
    </div>
    <p class="text-xs text-mute mt-3">Consejo: tras exportar, elige “Guardar en Archivos” → iCloud Drive. Si algún día reinstalas la app o cambias de iPhone, importas ese archivo y recuperas todo.</p>`);
}

/* ============================================================
   Biblioteca de ejercicios base
   ============================================================ */
const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const buscarExistente = (clave, nombre) =>
  state.ejercicios.find((e) => e.clave === clave) || state.ejercicios.find((e) => norm(e.nombre) === norm(nombre));

function actualizarContadoresBib() {
  sheetRoot.querySelectorAll('.bib-n').forEach((el) => {
    const cs = [...sheetRoot.querySelectorAll(`input[name="b"][data-g="${el.dataset.g}"]`)];
    el.textContent = `${cs.filter((c) => c.checked).length}/${cs.length}`;
  });
}

function sheetBiblioteca() {
  const grupos = BIBLIOTECA.map((g) => ({ ...g, items: g.ejercicios.map(([clave, nombre, tipo]) => ({ clave, nombre, tipo, ex: buscarExistente(clave, nombre) })) }));
  const hayAlguno = grupos.some((g) => g.items.some((i) => i.ex));
  abrirSheet(`<form data-form="biblioteca" autocomplete="off">
    <h2 class="text-xl font-bold">Biblioteca de ejercicios</h2>
    <p class="text-sm text-mute mt-1 mb-3">Marca los que quieras tener. <b class="text-ink">Desmarca para eliminarlos</b>: si ya tienen registros te avisaré antes de borrar nada.</p>
    <div class="space-y-2">${grupos.map((g) => `<details class="bib-g">
      <summary><span>${esc(g.nombre)}</span><span class="bib-n" data-g="${g.clave}"></span></summary>
      <div class="space-y-1.5 pt-3">${g.items.map((i) => {
        const marcado = i.ex ? true : (!hayAlguno && GRUPOS_INICIALES.includes(g.clave));
        const conRegistros = i.ex && tieneSeries(i.ex.id);
        return `<label class="check-row"><input type="checkbox" name="b" value="${i.clave}" data-g="${g.clave}" class="sr-only peer" ${marcado ? 'checked' : ''}>
          <span class="check-box peer-checked:bg-accent peer-checked:border-accent">✓</span>
          <span class="min-w-0 flex-1"><span class="block font-semibold leading-snug">${esc(i.nombre)}</span>
          <span class="block text-xs text-mute">${tipoTxt(i.tipo)}${conRegistros ? ' · <span class="text-warn">con registros</span>' : ''}</span></span></label>`;
      }).join('')}
        <div class="flex gap-2 pt-1"><button type="button" class="btn-mini" data-action="bib-grupo" data-g="${g.clave}" data-v="1">Todos</button>
        <button type="button" class="btn-mini" data-action="bib-grupo" data-g="${g.clave}" data-v="0">Ninguno</button></div>
      </div></details>`).join('')}</div>
    <div class="sheet-foot grid gap-2">
      <button class="btn-primary" type="submit">Aplicar cambios</button>
      <button type="button" class="btn-ghost" data-action="close-sheet">Cancelar</button></div></form>`);
  actualizarContadoresBib();
}

async function objetivoDeBiblioteca(g) {
  let o = state.objetivos.find((x) => x.clave === g.clave) || state.objetivos.find((x) => norm(x.nombre) === norm(g.nombre));
  if (!o) { o = { id: uid(), nombre: g.nombre, clave: g.clave }; state.objetivos.push(o); await DB.put('objetivos', o); }
  return o;
}

async function aplicarBiblioteca(marcados) {
  const aCrear = [], aBorrar = [];
  for (const g of BIBLIOTECA) for (const [clave, nombre, tipo] of g.ejercicios) {
    const ex = buscarExistente(clave, nombre);
    if (marcados.has(clave) && !ex) aCrear.push({ g, clave, nombre, tipo });
    else if (!marcados.has(clave) && ex) aBorrar.push(ex);
  }
  if (!aCrear.length && !aBorrar.length) { cerrarSheet(); toast('Sin cambios'); return; }

  const conRegistros = aBorrar.filter((e) => tieneSeries(e.id));
  if (conRegistros.length) {
    const ids = new Set(conRegistros.map((e) => e.id));
    const series = state.series.filter((s) => ids.has(s.ejercicio_id));
    const dias = new Set(series.map((s) => s.entrenamiento_id)).size;
    const ok = await confirmar({
      titulo: 'Hay ejercicios con registros',
      texto: `⚠ ${conRegistros.map((e) => e.nombre).slice(0, 3).join(', ')}${conRegistros.length > 3 ? ` y ${conRegistros.length - 3} más` : ''}: ${series.length} series en ${dias} entreno${dias === 1 ? '' : 's'}. Si continúas se borrarán también esos registros.`,
      ok: 'Eliminar y aplicar', peligro: true });
    if (!ok) { sheetBiblioteca(); return; }
  }
  await conDeshacer(`Biblioteca: +${aCrear.length} · −${aBorrar.length}`, async () => {
    for (const ex of aBorrar) await borrarEjercicio(ex.id);
    for (const c of aCrear) {
      const o = await objetivoDeBiblioteca(c.g);
      const ej = { id: uid(), nombre: c.nombre, tipo: c.tipo, objetivo_id: o.id, clave: c.clave };
      state.ejercicios.push(ej);
      await DB.put('ejercicios', ej);
    }
  });
  cerrarSheet({ silencioso: true }); render();
}

/* ============================================================
   Vista: HISTORIAL
   ============================================================ */
function entrenosDelMes(y, m) {
  const pref = `${y}-${String(m + 1).padStart(2, '0')}`;
  return state.entrenamientos.filter((e) => e.fecha.startsWith(pref)).sort((a, b) => b.fecha.localeCompare(a.fecha));
}

function calendarioYLista(selFecha) {
  const h = ui.hist;
  const celdas = gridMes(h.y, h.m);
  const conEntreno = new Set(state.entrenamientos.map((e) => e.fecha));
  const dias = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const cal = `<div class="card !p-3">
    <div class="flex items-center justify-between mb-2">
      <button class="icon-btn" data-action="hist-mes" data-d="-1" aria-label="Mes anterior">${I.back}</button>
      <p class="font-bold text-lg capitalize">${nombreMes(h.m)} ${h.y}</p>
      <button class="icon-btn" data-action="hist-mes" data-d="1" aria-label="Mes siguiente">${I.next}</button>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-mute mb-1">${dias.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="grid grid-cols-7 gap-1">${celdas.map((f) => f
      ? `<button class="cal-d ${conEntreno.has(f) ? 'has' : ''} ${f === hoy() ? 'today' : ''} ${f === selFecha ? 'sel' : ''}" data-action="hist-dia" data-fecha="${f}" aria-label="${esc(fechaLarga(f))}${conEntreno.has(f) ? ', con entreno' : ''}">${+f.slice(8)}</button>`
      : '<span></span>').join('')}</div></div>`;

  const lista = entrenosDelMes(h.y, h.m);
  const items = lista.length ? lista.map((ent) => {
    const nombres = ent.ejercicios.map((id) => ejById(id)?.nombre).filter(Boolean);
    const sets = state.series.filter((s) => s.entrenamiento_id === ent.id && serieHecha(s)).length;
    return `<button class="card w-full text-left flex items-center justify-between gap-3 !p-3.5 ${ent.fecha === selFecha ? 'row-sel' : ''}" data-action="hist-dia" data-fecha="${ent.fecha}">
      <span class="min-w-0"><span class="block font-semibold first-letter:uppercase">${esc(fechaLarga(ent.fecha))}</span>
      <span class="block text-sm text-mute truncate">${esc(nombres.slice(0, 3).join(' · '))}${nombres.length > 3 ? ` +${nombres.length - 3}` : ''}</span></span>
      <span class="text-sm text-mute shrink-0">${sets} series ${I.next}</span></button>`;
  }).join('') : `<div class="card text-center text-mute py-8">Sin entrenos este mes.</div>`;

  return cal + `<h2 class="text-sm uppercase tracking-widest text-mute font-semibold mt-5 mb-2">${nombreMes(h.m)}</h2><div class="space-y-2">${items}</div>`;
}

const entrenosOrdenados = () => [...state.entrenamientos].sort((a, b) => b.fecha.localeCompare(a.fecha));

function renderHistory() {
  const h = ui.hist;
  const pc = esPC();
  if (h.sel && !pc) return vistaDia(h.sel);
  const sel = pc ? (h.sel || entrenosOrdenados()[0]?.fecha || null) : null;
  const cab = hdr('Historial', 'Entrenos', `${state.entrenamientos.length} en total`, `<button class="icon-btn" data-action="resumen-ia" aria-label="Resumen para IA">${I.ia}</button>`);
  const izq = calendarioYLista(sel);
  if (!pc) return cab + izq;
  return cab + `<div class="hist-split"><div class="hist-list pc-scroll">${izq}</div>
    <div class="hist-detail">${sel ? vistaDia(sel, true) : '<div class="card text-center text-mute py-10">Aún no hay entrenos registrados.</div>'}</div></div>`;
}

function bloqueCheckin(ent) {
  const partes = [];
  if (ent.energia != null) partes.push(`<span class="chip">Energía ${ent.energia}/100</span>`);
  if (ent.sensacion) partes.push(chip(ent.sensacion));
  for (const m of ent.molestias || []) partes.push(`<span class="chip !text-warn">${esc(m)}</span>`);
  if (!partes.length && !(ent.notas || '').trim()) return '';
  return `<div class="note mb-3">${partes.length ? `<div class="flex flex-wrap gap-1.5">${partes.join('')}</div>` : ''}${(ent.notas || '').trim() ? `<p class="text-sm ${partes.length ? 'mt-2' : ''}">${esc(ent.notas)}</p>` : ''}</div>`;
}

function vistaDia(fecha, pc = false) {
  const ent = entDe(fecha);
  const volver = pc ? '' : `<button class="icon-btn" data-action="hist-volver" aria-label="Volver">${I.back}</button>`;
  if (!ent) {
    return hdr('Historial', esc(fechaEtiqueta(fecha)), '', volver) +
      `<div class="card text-center py-10"><p class="text-mute mb-4">No hay entreno registrado este día.</p>
      <button class="btn-primary w-full" data-action="hist-editar" data-fecha="${fecha}">Registrar entreno</button></div>`;
  }
  const bloques = ent.ejercicios.map((ejId) => {
    const ej = ejById(ejId); if (!ej) return '';
    const obj = ej.objetivo_id && objById(ej.objetivo_id);
    const act = sesionesDeEjercicio(state, ejId).find((s) => s.entrenamiento_id === ent.id);
    const prev = sesionPrevia(state, ejId, ent.fecha);
    const u = ej.tipo === 'tiempo' ? 's' : 'reps';
    let cmp = '';
    if (!act) cmp = '<p class="text-sm text-mute">Sin series completadas.</p>';
    else if (!prev) cmp = '<p class="text-sm text-accent">★ Primera vez registrado</p>';
    else {
      const partes = [`Mejor serie ${deltaTxt(act.max - prev.max, u)}`, `Volumen ${deltaTxt(act.volumen - prev.volumen, u)}`];
      if (act.lastre > 0 || prev.lastre > 0) partes.push(`Lastre ${deltaTxt(act.lastre - prev.lastre, 'kg')}`);
      cmp = `<p class="text-sm leading-relaxed">${partes.join(' &nbsp;·&nbsp; ')}</p>
        <p class="text-xs text-mute mt-1">vs ${esc(fechaCorta(prev.fecha))}: ${prev.sets.map((s) => fmtSerie(s, ej.tipo)).join(' · ')}</p>`;
    }
    const sets = act ? act.sets.map((s) => `<span class="set-pill">${fmtV(s.valor, ej.tipo)}${ej.tipo === 'complejo' && s.segundos ? `<small>×${num(s.segundos, 0)}s</small>` : ''}${s.peso_extra ? `<small> +${num(s.peso_extra)}kg</small>` : ''}</span>`).join('') : '';
    return `<section class="card"><div class="flex items-start justify-between gap-2 mb-2">
        <h3 class="font-bold text-lg leading-tight">${esc(ej.nombre)}</h3>${obj ? chip(obj.nombre) : ''}</div>
      <div class="flex flex-wrap gap-1.5 mb-3">${sets}</div>${cmp}</section>`;
  }).join('');

  const dia = fechaLarga(ent.fecha).split(' ');
  return hdr('Historial', dia.slice(1).join(' '), `<span class="inline-block first-letter:uppercase">${dia[0]}</span> · ${resumenTxt(ent)}`, volver) +
    bloqueCheckin(ent) +
    `<div class="space-y-3">${bloques}</div>
     <div class="grid grid-cols-2 gap-2 mt-4">
       <button class="btn-ghost" data-action="hist-editar" data-fecha="${ent.fecha}">Editar</button>
       <button class="btn-danger" data-action="hist-borrar" data-id="${ent.id}">Eliminar</button></div>`;
}

/* ============================================================
   Vista: PROGRESO (ejercicios y objetivos)
   ============================================================ */
function renderStats() {
  const st = ui.stats;
  if (esPC()) return renderStatsPC();
  if (st.ejId && ejById(st.ejId)) return vistaEjercicio(ejById(st.ejId));
  if (st.objId && objById(st.objId)) return vistaObjetivo(objById(st.objId));
  st.ejId = st.objId = null;

  const tabs = `<div class="seg mb-4" role="tablist">
    <button class="seg-btn" role="tab" aria-pressed="${st.tab === 'ejercicios'}" data-action="stats-tab" data-tab="ejercicios">Ejercicios</button>
    <button class="seg-btn" role="tab" aria-pressed="${st.tab === 'objetivos'}" data-action="stats-tab" data-tab="objetivos">Objetivos</button></div>`;
  const ajustes = `<button class="icon-btn" data-action="ajustes" aria-label="Datos y copias de seguridad">${I.sliders}</button>`;
  return hdr('Progreso', 'Estadísticas', nubeChip(), ajustes) + tabs + (st.tab === 'ejercicios' ? listaEjercicios() : listaObjetivos());
}

/** PC: lista a la izquierda y detalle (gráfica grande) a la derecha; siempre hay algo seleccionado. */
function renderStatsPC() {
  const st = ui.stats;
  if (st.tab === 'ejercicios') {
    if (!(st.ejId && ejById(st.ejId))) st.ejId = [...state.ejercicios].sort(byNombre)[0]?.id || null;
    st.objId = null;
  } else {
    if (!(st.objId && objById(st.objId))) st.objId = [...state.objetivos].sort(byNombre)[0]?.id || null;
    st.ejId = null;
  }
  const tabs = `<div class="seg mb-4" role="tablist">
    <button class="seg-btn" role="tab" aria-pressed="${st.tab === 'ejercicios'}" data-action="stats-tab" data-tab="ejercicios">Ejercicios</button>
    <button class="seg-btn" role="tab" aria-pressed="${st.tab === 'objetivos'}" data-action="stats-tab" data-tab="objetivos">Objetivos</button></div>`;
  const ej = st.ejId && ejById(st.ejId), ob = st.objId && objById(st.objId);
  const detalle = ej ? vistaEjercicio(ej, true) : ob ? vistaObjetivo(ob, true)
    : '<div class="card text-center text-mute py-10">Crea un ejercicio u objetivo para ver su progreso.</div>';
  return hdr('Progreso', 'Estadísticas', '', '') +
    `<div class="stats-split"><div class="stats-list pc-scroll">${tabs}${st.tab === 'ejercicios' ? listaEjercicios() : listaObjetivos()}</div>
      <div class="stats-detail">${detalle}</div></div>`;
}

function listaEjercicios() {
  if (!state.ejercicios.length) {
    return `<div class="card text-center py-8"><p class="font-semibold text-lg mb-1">Crea tu primer ejercicio</p>
      <p class="text-mute text-sm mb-4">Crea los tuyos o parte de la biblioteca de calistenia con sus progresiones.</p>
      <div class="grid gap-2"><button class="btn-primary" data-action="nuevo-ej">＋ Nuevo ejercicio</button>
      <button class="btn-ghost" data-action="biblioteca">Abrir biblioteca de ejercicios</button></div></div>`;
  }
  const items = [...state.ejercicios].sort(byNombre).map((e) => {
    const r = resumenEjercicio(state, e.id, 'max');
    const obj = e.objetivo_id && objById(e.objetivo_id);
    const sub = r.sesiones.length
      ? `Récord ${fmtMetrica(r.record, e, 'max')} · ${r.sesiones.length} sesion${r.sesiones.length === 1 ? '' : 'es'}`
      : 'Sin registros todavía';
    return `<button class="card w-full text-left !p-3.5 ${esPC() && ui.stats.ejId === e.id ? 'row-sel' : ''}" data-action="stats-ej" data-id="${e.id}">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0"><p class="font-bold truncate">${esc(e.nombre)}</p>
          <p class="text-xs text-mute truncate">${obj ? esc(obj.nombre) + ' · ' : ''}${sub}</p></div>
        ${sparkline(r.valores.slice(-12))}</div>
      <div class="mt-2">${badge(r.tend)}</div></button>`;
  }).join('');
  return `<div class="space-y-2">${items}</div><div class="grid grid-cols-2 gap-2 mt-3"><button class="btn-ghost" data-action="nuevo-ej">＋ Nuevo</button><button class="btn-ghost" data-action="biblioteca">Biblioteca</button></div>`;
}

function listaObjetivos() {
  if (!state.objetivos.length) {
    return `<div class="card text-center py-8"><p class="font-semibold text-lg mb-1">Agrupa ejercicios en objetivos</p>
      <p class="text-mute text-sm mb-4">Ej. “Press a pino” = Pike push-ups + aguantes en pino. Verás si el conjunto avanza.</p>
      <button class="btn-primary w-full" data-action="nuevo-obj">＋ Nuevo objetivo</button></div>`;
  }
  const items = [...state.objetivos].sort(byNombre).map((o) => {
    const p = progresoObjetivo(state, o.id);
    return `<button class="card w-full text-left !p-3.5 ${esPC() && ui.stats.objId === o.id ? 'row-sel' : ''}" data-action="stats-obj" data-id="${o.id}">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0"><p class="font-bold truncate">${esc(o.nombre)}</p>
          <p class="text-xs text-mute">${p.ejercicios.length} ejercicio${p.ejercicios.length === 1 ? '' : 's'}</p></div>
        ${sparkline(p.puntos.map((x) => x.y).slice(-12))}</div>
      <div class="mt-2">${badge(p.tend)}</div></button>`;
  }).join('');
  return `<div class="space-y-2">${items}</div><button class="btn-ghost w-full mt-3" data-action="nuevo-obj">＋ Nuevo objetivo</button>`;
}

function chartBlock(puntos, fmtAxis, textoSel) {
  const st = ui.stats;
  if (!puntos.length) return `<div class="card text-center text-mute py-10">Aún no hay datos. Registra series en “Entrenar” y aparecerán aquí.</div>`;
  const sel = st.sel != null && st.sel < puntos.length ? st.sel : puntos.length - 1;
  return `<div class="card !p-3">
    <p class="text-sm px-1 pb-1 min-h-[1.5rem]">${textoSel(puntos[sel])}</p>
    ${lineChart(puntos, { sel, fmt: fmtAxis, ...(esPC() ? { w: 760, h: 340 } : {}) })}
    <p class="text-[11px] text-mute text-center">${esPC() ? 'Haz clic en un punto' : 'Toca un punto'} para ver su valor</p></div>`;
}

function vistaEjercicio(ej, pc = false) {
  const st = ui.stats;
  const base = sesionesDeEjercicio(state, ej.id);
  const hayLastre = base.some((s) => s.lastre > 0);
  const hayAguante = ej.tipo === 'complejo' && base.some((s) => s.aguante > 0);
  if (st.metrica === 'lastre' && !hayLastre) st.metrica = 'max';
  if (st.metrica === 'aguante' && !hayAguante) st.metrica = 'max';
  const m = st.metrica;
  const r = resumenEjercicio(state, ej.id, m);
  const obj = ej.objetivo_id && objById(ej.objetivo_id);
  const u = ej.tipo === 'tiempo' ? 'segundos' : ej.tipo === 'complejo' ? 'repeticiones (cada una con su aguante)' : 'repeticiones';

  const chips = ['max', 'volumen', ...(hayLastre ? ['lastre'] : []), ...(hayAguante ? ['aguante'] : [])].map((k) =>
    `<button class="seg-btn !h-9 !text-xs" aria-pressed="${m === k}" data-action="stats-metrica" data-m="${k}">${METRICAS[k].label}</button>`).join('');
  const pts = r.sesiones.map((s) => ({ fecha: s.fecha, y: valorMetrica(s, m) }));

  const tile = (k, v) => `<div class="card !p-3"><p class="text-[11px] uppercase tracking-wider text-mute font-semibold">${k}</p><p class="text-xl font-extrabold mt-0.5">${v}</p></div>`;
  const ult = r.ultima;
  const historial = [...r.sesiones].reverse().slice(0, 12).map((s, i, arr) => {
    const ant = arr[i + 1];
    return `<div class="flex items-center justify-between gap-2 py-2.5 border-b border-line last:border-0">
      <div class="min-w-0"><p class="text-sm font-semibold">${esc(fechaCorta(s.fecha))}</p>
      <p class="text-xs text-mute truncate">${s.sets.map((x) => fmtSerie(x, ej.tipo)).join(' · ')}</p></div>
      <span class="text-xs shrink-0">${ant ? deltaTxt(s.max - ant.max, ej.tipo === 'tiempo' ? 's' : 'reps') : '<span class="text-mute">inicio</span>'}</span></div>`;
  }).join('');

  const editar = `<button class="icon-btn" data-action="editar-ej" data-id="${ej.id}" aria-label="Editar ejercicio">${I.edit}</button>`;
  return `<header class="flex items-center gap-2 mb-4">
      ${pc ? '' : `<button class="icon-btn" data-action="stats-back" aria-label="Volver">${I.back}</button>`}
      <div class="min-w-0 flex-1"><h1 class="text-2xl font-extrabold tracking-tight truncate">${esc(ej.nombre)}</h1>
        <p class="text-xs text-mute">${obj ? esc(obj.nombre) + ' · ' : ''}Medido en ${u}</p></div>${editar}</header>
    <div class="seg3 mb-3">${chips}</div>
    ${chartBlock(pts, (v) => num(v, v < 10 ? 1 : 0), (p) => `<b>${esc(fechaCorta(p.fecha))}</b> · ${fmtMetrica(p.y, ej, m)}`)}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
      ${tile('Récord', r.record != null ? fmtMetrica(r.record, ej, m) : '–')}
      ${tile('Última', ult ? fmtMetrica(valorMetrica(ult, m), ej, m) : '–')}
      ${tile('Sesiones', r.sesiones.length)}
      <div class="card !p-3"><p class="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1.5">Tendencia</p>${badge(r.tend)}</div>
    </div>
    <p class="text-xs text-mute mt-2">${METRICAS[m].desc}. Tendencia: últimas sesiones frente a las anteriores (±2,5 % = estancado).</p>
    ${r.sesiones.length ? `<h2 class="text-sm uppercase tracking-widest text-mute font-semibold mt-5 mb-1">Últimas sesiones</h2><div class="card !py-1 !px-3.5">${historial}</div>` : ''}`;
}

function vistaObjetivo(o, pc = false) {
  const p = progresoObjetivo(state, o.id);
  const editar = `<button class="icon-btn" data-action="editar-obj" data-id="${o.id}" aria-label="Editar objetivo">${I.edit}</button>`;
  const filas = p.porEjercicio.map((x) => `
    <button class="w-full flex items-center justify-between gap-3 py-2.5 border-b border-line last:border-0 text-left" data-action="stats-ej" data-id="${x.ej.id}">
      <span class="min-w-0"><span class="block font-semibold truncate">${esc(x.ej.nombre)}</span>
      <span class="block text-xs text-mute">${fmtV(x.inicio, x.ej.tipo)} → ${fmtV(x.actual, x.ej.tipo)} (${x.cambioPct > 0 ? '+' : ''}${num(x.cambioPct, 0)}%)</span></span>
      ${badge(x.tend, false)}</button>`).join('');
  const sinDatos = p.ejercicios.filter((e) => !p.porEjercicio.some((x) => x.ej.id === e.id));
  const signo = (v) => `${v > 0 ? '+' : ''}${num(v, 0)}%`;
  return `<header class="flex items-center gap-2 mb-4">
      ${pc ? '' : `<button class="icon-btn" data-action="stats-back" aria-label="Volver">${I.back}</button>`}
      <div class="min-w-0 flex-1"><h1 class="text-2xl font-extrabold tracking-tight truncate">${esc(o.nombre)}</h1>
        <p class="text-xs text-mute">Progreso combinado · 100 = punto de partida</p></div>${editar}</header>
    <div class="mb-3">${badge(p.tend)}</div>
    ${chartBlock(p.puntos, (v) => num(v, 0), (pt) => `<b>${esc(fechaCorta(pt.fecha))}</b> · índice ${num(pt.y, 0)} (${signo(pt.y - 100)} vs inicio)`)}
    <p class="text-xs text-mute mt-2">Cada ejercicio se compara con su primera marca (mejor serie) y se promedia el conjunto. Si sube, tus ejercicios de apoyo te acercan al objetivo.</p>
    ${p.porEjercicio.length ? `<h2 class="text-sm uppercase tracking-widest text-mute font-semibold mt-5 mb-1">Ejercicios del objetivo</h2><div class="card !py-1 !px-3.5">${filas}</div>` : ''}
    ${sinDatos.length ? `<p class="text-xs text-mute mt-3">Sin registros aún: ${sinDatos.map((e) => esc(e.nombre)).join(', ')}.</p>` : ''}
    ${!p.ejercicios.length ? `<div class="card text-center mt-3"><p class="text-mute mb-3">Este objetivo aún no tiene ejercicios.</p><button class="btn-primary w-full" data-action="editar-obj" data-id="${o.id}">Añadir ejercicios</button></div>` : ''}`;
}

/* ============================================================
   Copias de seguridad
   ============================================================ */
async function exportar() {
  const json = DB.exportarJSON(state);
  const nombre = `calistenia-copia-${hoy()}.json`;
  const file = new File([json], nombre, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Copia Calisthenics Tracker' });
    } else {
      const url = URL.createObjectURL(file);
      const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // el usuario canceló el menú de compartir
    toast('No se pudo exportar'); return;
  }
  ui.ultimaCopia = new Date().toISOString();
  await DB.setMeta('ultimaCopia', ui.ultimaCopia);
  toast('Copia exportada');
  cerrarSheet(); render();
}

function importar() {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    try {
      const datos = DB.validarImport(await f.text());
      const ok = await confirmar({
        titulo: 'Importar copia',
        texto: `Se reemplazarán los datos actuales por los de la copia: ${datos.entrenamientos.length} entrenos, ${datos.ejercicios.length} ejercicios. Esta acción no se puede deshacer.`,
        ok: 'Reemplazar mis datos', peligro: true,
      });
      if (!ok) return;
      await DB.replaceAll(datos);
      Object.assign(state, await DB.loadAll());
      await normalizar();
      ui.stats.ejId = ui.stats.objId = null; ui.hist.sel = null;
      toast('Copia importada'); render({ top: true });
    } catch (e) { toast(e.message || 'No se pudo importar'); }
  };
  inp.click();
}

/* ============================================================
   Service worker / actualizaciones
   ============================================================ */
function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  let recargando = false;
  // Solo recargamos al ACTUALIZAR una versión ya instalada; en la primera instalación el SW toma el
  // control sin que haga falta recargar (y recargar ahí interrumpiría lo que el usuario esté haciendo).
  const teniaControlador = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (teniaControlador && !recargando) { recargando = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const avisar = (w) => { ui.updateSW = w; if (ui.view === 'train') render(); toast('Hay una versión nueva', { action: 'actualizar-app', label: 'Actualizar' }); };
    if (reg.waiting && navigator.serviceWorker.controller) avisar(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) avisar(w); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    ui.reg = reg;
  }).catch((e) => console.warn('SW no registrado', e));
}

/* ============================================================
   Eventos (delegación)
   ============================================================ */
const irA = (v) => { ui.view = v; if (v !== 'stats') { ui.stats.ejId = ui.stats.objId = null; } render({ top: true }); };

const acciones = {
  'close-sheet': () => cerrarSheet(),
  'confirm-ok': () => { const r = confirmRes; confirmRes = null; cerrarSheet({ silencioso: true }); r && r(true); },

  // Entrenar
  dia: (el) => { ui.fecha = addDays(ui.fecha, +el.dataset.d); render({ top: true }); },
  'dia-hoy': () => { ui.fecha = hoy(); render({ top: true }); },
  picker: () => sheetPicker(),
  'nuevo-ej-entreno': () => sheetEjercicio(null, { anadir: true }),
  'pick-ej': async (el) => { await addEjAlEntreno(el.dataset.id); cerrarSheet(); render(); },
  'add-serie': async (el) => {
    const ejId = el.closest('[data-ej]').dataset.ej;
    await addSerie(ejId); render();
    // la serie nueva debe verse siempre (no quedar tras el botón fijo ni la barra)
    const filas = document.querySelectorAll(`[data-ej="${ejId}"] [data-serie]`);
    filas[filas.length - 1]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  },
  'del-serie': async (el) => {
    if (ui.crono) pararCrono();
    const id = el.closest('[data-serie]').dataset.serie;
    await conDeshacer('Serie eliminada', () => delSerie(id)); render();
  },
  'check-serie': (el) => {
    const row = el.closest('[data-serie]');
    const s = state.series.find((x) => x.id === row.dataset.serie); if (!s) return;
    if (ui.crono && ui.crono.id === s.id) { pararCrono(); return; }
    if (serieHecha(s)) s.hecha = false;
    else {
      if (!(s.valor > 0)) {
        // Un toque = repetir la marca de la última vez en esa misma serie
        const ent = entDe(ui.fecha);
        const idx = seriesDe(ent.id, s.ejercicio_id).findIndex((x) => x.id === s.id);
        const p = (sesionPrevia(state, s.ejercicio_id, ui.fecha) || {}).sets?.[idx];
        if (!p) { toast('Introduce primero las reps o los segundos'); row.querySelector('[data-field="valor"]').focus(); return; }
        s.valor = p.valor; row.querySelector('[data-field="valor"]').value = s.valor;
        if (s.peso_extra == null && p.peso_extra) { s.peso_extra = p.peso_extra; row.querySelector('[data-field="peso"]').value = s.peso_extra; }
        if (s.segundos == null && p.segundos) { s.segundos = p.segundos; const sg = row.querySelector('[data-field="seg"]'); if (sg) sg.value = s.segundos; }
      }
      s.hecha = true;
    }
    queue('series', s); pintarFila(row, s); refreshResumen();
  },
  deshacer: () => deshacer(),
  sens: (el) => {
    const ent = entDe(ui.fecha); if (!ent) return;
    if (ent.sensacion === el.dataset.v) delete ent.sensacion; else ent.sensacion = el.dataset.v;
    queue('entrenamientos', ent);
    document.querySelectorAll('[data-action="sens"]').forEach((b) => b.setAttribute('aria-pressed', String(ent.sensacion === b.dataset.v)));
  },
  molestia: (el) => {
    const ent = entDe(ui.fecha); if (!ent) return;
    const set = new Set(ent.molestias || []);
    if (set.has(el.dataset.v)) set.delete(el.dataset.v); else set.add(el.dataset.v);
    if (set.size) ent.molestias = MOLESTIAS.filter((m) => set.has(m)); else delete ent.molestias;
    queue('entrenamientos', ent);
    el.setAttribute('aria-pressed', String(set.has(el.dataset.v)));
  },
  'energia-clear': () => {
    const ent = entDe(ui.fecha); if (!ent) return;
    delete ent.energia; queue('entrenamientos', ent);
    const r = $('[data-field="energia"]'); if (r) { r.value = 50; r.classList.add('unset'); }
    const v = $('#energia-val'); if (v) v.textContent = 'Sin indicar';
    $('[data-action="energia-clear"]')?.classList.add('hidden');
  },
  'resumen-ia': () => sheetResumenIA(),
  'ia-periodo': (el) => { ui.ia.dias = +el.dataset.d; sheetResumenIA(); },
  'ia-instr': () => { ui.ia.instr = !ui.ia.instr; sheetResumenIA(); },
  'ia-copiar': async () => { toast((await copiarTexto(ui.iaTxt)) ? 'Resumen copiado' : 'No se pudo copiar: selecciona el texto a mano'); },
  'ia-compartir': async () => { try { await navigator.share({ title: 'Mi registro de calistenia', text: ui.iaTxt }); } catch (e) { if (e && e.name !== 'AbortError') toast('No se pudo compartir'); } },
  'nube-sync': async () => { await Sync.ahora(); pintarNube(); },
  'nube-logout': async () => { await Sync.logout(); pintarNube(); render(); toast('Sesión cerrada (tus datos siguen en este iPhone)'); },
  'cerrar-nube': () => { lsSet('ct-nube-ok', '1'); render(); },
  biblioteca: () => sheetBiblioteca(),
  'bib-grupo': (el) => {
    sheetRoot.querySelectorAll(`input[name="b"][data-g="${el.dataset.g}"]`).forEach((c) => { c.checked = el.dataset.v === '1'; });
    actualizarContadoresBib();
  },
  crono: (el) => toggleCrono(el.closest('[data-serie]').dataset.serie),
  'menu-ej': (el) => {
    const ejId = el.closest('[data-ej]').dataset.ej;
    abrirSheet(`<h2 class="text-xl font-bold mb-3">${esc(ejById(ejId).nombre)}</h2><div class="grid gap-2">
      <button class="btn-ghost" data-action="editar-ej" data-id="${ejId}">Editar ejercicio</button>
      <button class="btn-danger" data-action="quitar-ej" data-id="${ejId}">Quitar de este entreno</button>
      <button class="btn-ghost" data-action="close-sheet">Cerrar</button></div>`);
  },
  'quitar-ej': async (el) => {
    if (ui.crono) pararCrono();
    cerrarSheet();
    await conDeshacer('Ejercicio quitado del entreno', () => quitarEjDelEntreno(el.dataset.id)); render();
  },

  // Formularios
  'editar-ej': (el) => sheetEjercicio(el.dataset.id),
  'nuevo-ej': () => sheetEjercicio(),
  'borrar-ej': async () => {
    const id = sheetCtx.ejId; const ej = ejById(id);
    const n = state.series.filter((s) => s.ejercicio_id === id).length;
    const dias = new Set(state.series.filter((s) => s.ejercicio_id === id).map((s) => s.entrenamiento_id)).size;
    const ok = await confirmar({
      titulo: `Eliminar «${ej.nombre}»`,
      texto: n ? `⚠ Tiene ${n} series registradas en ${dias} entreno${dias === 1 ? '' : 's'}. Se borrarán también.` : 'No tiene registros.',
      ok: 'Eliminar', peligro: true });
    if (ok) { if (ui.stats.ejId === id) ui.stats.ejId = null; await conDeshacer('Ejercicio eliminado', () => borrarEjercicio(id)); render(); }
  },
  'nuevo-obj': () => sheetObjetivo(),
  'editar-obj': (el) => sheetObjetivo(el.dataset.id),
  'borrar-obj': async () => {
    const id = sheetCtx.objId; const o = objById(id);
    const ok = await confirmar({ titulo: `Eliminar «${o.nombre}»`, texto: 'Los ejercicios no se borran; solo se desvinculan del objetivo.', ok: 'Eliminar', peligro: true });
    if (ok) { if (ui.stats.objId === id) ui.stats.objId = null; await conDeshacer('Objetivo eliminado', () => borrarObjetivo(id)); render(); }
  },

  // Historial
  'hist-mes': (el) => {
    const h = ui.hist; const d = new Date(h.y, h.m + +el.dataset.d, 1);
    h.y = d.getFullYear(); h.m = d.getMonth(); render();
  },
  'hist-dia': (el) => { ui.hist.sel = el.dataset.fecha; render({ top: !esPC() }); },
  'hist-volver': () => { ui.hist.sel = null; render({ top: true }); },
  'hist-editar': (el) => { ui.fecha = el.dataset.fecha; ui.hist.sel = null; irA('train'); },
  'hist-borrar': async (el) => {
    const ok = await confirmar({ titulo: 'Eliminar entreno', texto: 'Se eliminarán todas las series de este día.', ok: 'Eliminar', peligro: true });
    if (ok) { await conDeshacer('Entreno eliminado', () => borrarEntreno(el.dataset.id)); ui.hist.sel = null; render({ top: true }); }
  },

  // Progreso
  'stats-tab': (el) => { ui.stats.tab = el.dataset.tab; if (esPC()) { ui.stats.ejId = ui.stats.objId = null; ui.stats.sel = null; } render(); },
  'stats-ej': (el) => { Object.assign(ui.stats, { ejId: el.dataset.id, objId: null, sel: null, metrica: 'max' }); if (esPC()) ui.stats.tab = 'ejercicios'; ui.view = 'stats'; render({ top: !esPC() }); },
  'stats-obj': (el) => { Object.assign(ui.stats, { objId: el.dataset.id, ejId: null, sel: null }); if (esPC()) ui.stats.tab = 'objetivos'; render({ top: !esPC() }); },
  'stats-back': () => { Object.assign(ui.stats, { ejId: null, objId: null, sel: null }); render({ top: true }); },
  'stats-metrica': (el) => { ui.stats.metrica = el.dataset.m; ui.stats.sel = null; render(); },

  // Datos
  ajustes: () => sheetAjustes(),
  atajos: () => sheetAtajos(),
  exportar, importar,
  'buscar-update': async () => {
    try { await ui.reg?.update(); toast(ui.updateSW ? 'Hay una versión nueva' : 'Ya tienes la última versión'); } catch { toast('Sin conexión'); }
  },
  'actualizar-app': () => { (ui.updateSW || ui.reg?.waiting)?.postMessage('SKIP_WAITING'); },
  'cerrar-instala': () => { lsSet('ct-instala-ok', '1'); render(); },
  'borrar-todo': async () => {
    const ok = await confirmar({ titulo: 'Eliminar todos los datos', texto: Sync.estado.usuario ? 'Se eliminarán entrenos, ejercicios y objetivos de este iPhone Y TAMBIÉN de la nube (la sincronización propagará el borrado). Exporta una copia antes si no quieres perderlos.' : 'Se eliminarán entrenos, ejercicios y objetivos de este iPhone. Exporta una copia antes si no quieres perderlos.', ok: 'Eliminar todo', peligro: true });
    if (!ok) return;
    await DB.replaceAll({ objetivos: [], ejercicios: [], entrenamientos: [], series: [] });
    Object.assign(state, { objetivos: [], ejercicios: [], entrenamientos: [], series: [] });
    ui.stats.ejId = ui.stats.objId = null; ui.hist.sel = null;
    render({ top: true }); toast('Datos eliminados');
  },
};

document.addEventListener('click', async (e) => {
  if (e.target.matches?.('[data-field="energia"]')) { const ent = entDe(ui.fecha); if (ent && ent.energia == null) e.target.dispatchEvent(new Event('input', { bubbles: true })); }
  if (e.target.matches?.('[data-field="fecha"]') && punteroFino()) { try { e.target.showPicker?.(); } catch { /* opcional */ } }
  const navBtn = e.target.closest('[data-nav]');
  if (navBtn) { irA(navBtn.dataset.nav); return; }
  const pt = e.target.closest('[data-pt]');
  if (pt) { ui.stats.sel = +pt.dataset.pt; render(); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = acciones[el.dataset.action];
  if (fn) {
    try { await fn(el, e); } catch (err) { console.error(err); toast('No se pudo completar la acción. Inténtalo de nuevo.'); }
  }
});

document.addEventListener('input', (e) => {
  const el = e.target; const f = el.dataset.field; if (!f) return;
  if (f === 'valor' || f === 'peso' || f === 'seg') {
    const row = el.closest('[data-serie]'); const s = row && state.series.find((x) => x.id === row.dataset.serie); if (!s) return;
    if (ui.crono && ui.crono.id === s.id) pararCrono();
    const v = parseNum(el.value);
    if (f === 'valor') { s.valor = v; if (v > 0) s.hecha = true; } else if (f === 'seg') s.segundos = v; else s.peso_extra = v;   // teclear reps/segundos = serie hecha
    queue('series', s); pintarFila(row, s); refreshResumen();
  } else if (f === 'energia') {
    const ent = entDe(ui.fecha); if (!ent) return;
    ent.energia = +el.value; queue('entrenamientos', ent);
    el.classList.remove('unset');
    const v = $('#energia-val'); if (v) v.textContent = `${ent.energia} / 100`;
    $('[data-action="energia-clear"]')?.classList.remove('hidden');
  } else if (f === 'notas') {
    const ent = entDe(ui.fecha); if (ent) { ent.notas = el.value; queue('entrenamientos', ent); }
  } else if (f === 'buscar') {
    $('#picker-list').innerHTML = pickerItems(el.value);
  }
});

// Al entrar en un campo numérico se selecciona su contenido: corregir un valor = teclear encima.
document.addEventListener('focusin', (e) => {
  const el = e.target;
  // Solo si SIGUE siendo el campo activo: select() también da el foco, y si ya se movió a otro campo se lo robaría.
  if (el.matches?.('[data-field="valor"],[data-field="seg"],[data-field="peso"]')) setTimeout(() => { try { if (document.activeElement === el) el.select(); } catch { /* noop */ } }, 0);
});

/** Con teclado (PC): Enter pasa de reps a peso, de peso a la serie siguiente y, tras la última, crea otra. */
async function avanzarCampo(el) {
  const row = el.closest('[data-serie]'); if (!row) return;
  const campos = [...row.querySelectorAll('input[data-field]')];          // reps → (seg) → peso
  const sigCampo = campos[campos.indexOf(el) + 1];
  if (sigCampo) { sigCampo.focus(); return; }
  const sig = row.nextElementSibling;
  if (sig && sig.matches('[data-serie]')) { sig.querySelector('[data-field="valor"]')?.focus(); return; }
  const ejId = row.closest('[data-ej]').dataset.ej;
  await addSerie(ejId); render();
  const filas = document.querySelectorAll(`[data-ej="${ejId}"] [data-serie]`);
  filas[filas.length - 1]?.querySelector('[data-field="valor"]')?.focus();
}

function moverSeleccion(d) {
  if (ui.view === 'history') {
    const lista = entrenosOrdenados(); if (!lista.length) return;
    const cur = ui.hist.sel || lista[0].fecha;
    const i = Math.min(lista.length - 1, Math.max(0, lista.findIndex((x) => x.fecha === cur) + d));
    const f = lista[i].fecha;
    ui.hist.sel = f; ui.hist.y = +f.slice(0, 4); ui.hist.m = +f.slice(5, 7) - 1;
  } else if (ui.view === 'stats') {
    const st = ui.stats, ej = st.tab === 'ejercicios';
    const ids = [...(ej ? state.ejercicios : state.objetivos)].sort(byNombre).map((x) => x.id); if (!ids.length) return;
    const cur = ej ? st.ejId : st.objId;
    const id = ids[Math.min(ids.length - 1, Math.max(0, ids.indexOf(cur) + d))];
    Object.assign(st, ej ? { ejId: id, objId: null, metrica: 'max' } : { objId: id, ejId: null }, { sel: null });
  } else return;
  render();
  viewEl.querySelector('.row-sel')?.scrollIntoView({ block: 'nearest' });
}

function sheetAtajos() {
  const f = (k, t) => `<div class="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0"><span>${t}</span><kbd class="nav-kbd !inline-block !ml-0">${k}</kbd></div>`;
  abrirSheet(`<h2 class="text-xl font-bold mb-3">Atajos de teclado</h2>
    <div class="card !py-1 !px-3.5">
      ${f('1 · 2 · 3', 'Entrenar · Historial · Progreso')}
      ${f('N', 'Añadir ejercicio al entreno')}
      ${f('← →', 'Día anterior / siguiente (Entrenar)')}
      ${f('↑ ↓', 'Moverse por la lista (Historial y Progreso)')}
      ${f('Enter', 'Siguiente campo; tras la última serie crea otra')}
      ${f('Esc', 'Cerrar la ventana')}
      ${f('?', 'Mostrar esta ayuda')}
    </div>
    <button class="btn-ghost w-full mt-3" data-action="close-sheet">Cerrar</button>`);
}

function atajosGlobales(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input,textarea,select,[contenteditable]') || sheetRoot.firstChild) return;
  const k = e.key;
  if (k === '1' || k === '2' || k === '3') irA(['train', 'history', 'stats'][+k - 1]);
  else if (k === '?') sheetAtajos();
  else if ((k === 'n' || k === 'N') && ui.view === 'train') { e.preventDefault(); sheetPicker(); }
  else if (ui.view === 'train' && (k === 'ArrowLeft' || k === 'ArrowRight')) acciones.dia({ dataset: { d: k === 'ArrowLeft' ? -1 : 1 } });
  else if (esPC() && (k === 'ArrowUp' || k === 'ArrowDown')) { if (ui.view !== 'train') { e.preventDefault(); moverSeleccion(k === 'ArrowDown' ? 1 : -1); } }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-field="valor"],[data-field="seg"],[data-field="peso"]')) {
    e.preventDefault();
    if (punteroFino()) avanzarCampo(e.target); else e.target.blur();
    return;
  }
  if (e.key === 'Escape' && sheetRoot.firstChild) { cerrarSheet(); return; }
  atajosGlobales(e);
});

// Al cruzar el ancho de PC cambia la estructura de las pantallas: redibujamos.
matchMedia('(min-width:1024px)').addEventListener?.('change', () => { if (!document.body.classList.contains('sheet-open')) render(); });

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.field === 'fecha' && el.value) { ui.fecha = el.value; render({ top: true }); }
  if (el.name === 'b') actualizarContadoresBib();
  if (el.name === 'objetivo' && el.closest('[data-form="ejercicio"]')) {
    el.closest('form').querySelector('[name="objetivo_nuevo"]').classList.toggle('hidden', el.value !== '__nuevo');
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]'); if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  if (form.dataset.form === 'login') {
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Entrando…';
    try { await Sync.login(String(fd.get('email')).trim(), String(fd.get('password'))); toast('Sesión iniciada'); }
    catch (err) { Sync.estado.error = Sync.mensajeError(err); }
    pintarNube(); if (ui.view === 'train') render();
    return;
  }
  if (form.dataset.form === 'biblioteca') {
    try { await aplicarBiblioteca(new Set(fd.getAll('b'))); } catch (err) { avisarErrorGuardado(err); }
    return;
  }
  const nombre = String(fd.get('nombre') || '').trim();
  if (!nombre) return;
  const dup = (lista, id) => lista.some((x) => x.id !== id && x.nombre.toLowerCase() === nombre.toLowerCase());
  try {
    if (form.dataset.form === 'ejercicio') {
      const { ejId, anadir, bloquea, tipoActual } = sheetCtx;
      if (dup(state.ejercicios, ejId)) { toast('Ya existe un ejercicio con ese nombre'); return; }
      let objetivo_id = fd.get('objetivo') || null;
      if (objetivo_id === '__nuevo') {
        const n = String(fd.get('objetivo_nuevo') || '').trim();
        if (!n) { toast('Escribe el nombre del objetivo'); return; }
        const existente = state.objetivos.find((o) => o.nombre.toLowerCase() === n.toLowerCase());
        objetivo_id = existente ? existente.id : (await crearObjetivo(n)).id;
      }
      const tipo = bloquea ? tipoActual : fd.get('tipo') || 'reps';
      let ej = ejId && ejById(ejId);
      if (ej) Object.assign(ej, { nombre, tipo, objetivo_id });
      else { ej = { id: uid(), nombre, tipo, objetivo_id }; state.ejercicios.push(ej); }
      await DB.put('ejercicios', ej);
      if (anadir) await addEjAlEntreno(ej.id);
      cerrarSheet({ silencioso: true }); render(); toast(ejId ? 'Ejercicio actualizado' : 'Ejercicio creado');
    } else if (form.dataset.form === 'objetivo') {
      const { objId } = sheetCtx;
      if (dup(state.objetivos, objId)) { toast('Ya existe un objetivo con ese nombre'); return; }
      let o = objId && objById(objId);
      if (o) { o.nombre = nombre; await DB.put('objetivos', o); }
      else o = await crearObjetivo(nombre);
      const marcados = new Set(fd.getAll('ej'));
      const tocados = [];
      for (const e2 of state.ejercicios) {
        if (marcados.has(e2.id) && e2.objetivo_id !== o.id) { e2.objetivo_id = o.id; tocados.push(e2); }
        else if (!marcados.has(e2.id) && e2.objetivo_id === o.id) { e2.objetivo_id = null; tocados.push(e2); }
      }
      await DB.putMany('ejercicios', tocados);
      cerrarSheet({ silencioso: true }); render(); toast(objId ? 'Objetivo actualizado' : 'Objetivo creado');
    }
  } catch (err) { avisarErrorGuardado(err); }
});

/* ============================================================
   Arranque
   ============================================================ */
async function init() {
  try {
    if (!('indexedDB' in window)) throw new Error('Este navegador no soporta IndexedDB.');
    Object.assign(state, await DB.loadAll());
    await normalizar();
    ui.ultimaCopia = await DB.getMeta('ultimaCopia');
  } catch (e) {
    viewEl.innerHTML = `<div class="note mt-10"><p class="font-semibold">No se pudo abrir el almacenamiento local</p>
      <p class="text-sm text-mute mt-1">${esc(e.message || e)}. Si usas navegación privada, ábrela en una pestaña normal.</p></div>`;
    return;
  }
  render();
  Sync.iniciar({ getState: () => state, setState: aplicarEstadoRemoto, flush, onEstado: () => {
      pintarNube();
      const hay = !!Sync.estado.usuario, marca = hay + ':' + Sync.estado.fase;
      const cambio = hay !== ui.nubeUsuario || marca !== ui.nubeMarca;
      ui.nubeUsuario = hay; ui.nubeMarca = marca;
      const escribiendo = document.activeElement?.matches('input,textarea') || document.body.classList.contains('sheet-open');
      if (cambio && !escribiendo && (ui.view === 'train' || ui.view === 'stats')) render();
    } });
  DB.pedirPersistencia().then((p) => { ui.persist = p; });
  registrarSW();
}
init();

// Utilidades pequeñas sin dependencias.

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

const pad = (n) => String(n).padStart(2, '0');

/** Fecha local en formato YYYY-MM-DD (no UTC: evita que un entreno de las 00:30 caiga en el día anterior). */
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hoy = () => isoDate();

export const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (iso, n) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const nombreMes = (m) => MESES[m];

export const fechaCorta = (iso) => { const d = parseISO(iso); return `${d.getDate()} ${MESES_C[d.getMonth()]}`; };
export const fechaLarga = (iso) => {
  const d = parseISO(iso);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
};
export const fechaEtiqueta = (iso) => {
  if (iso === hoy()) return 'Hoy';
  if (iso === addDays(hoy(), -1)) return 'Ayer';
  if (iso === addDays(hoy(), 1)) return 'Mañana';
  return fechaLarga(iso);
};

/** Cuadrícula de un mes (semana empieza en lunes). Devuelve array de ISO | null. */
export const gridMes = (year, month) => {
  const primero = new Date(year, month, 1);
  const offset = (primero.getDay() + 6) % 7;
  const total = new Date(year, month + 1, 0).getDate();
  const celdas = [];
  for (let i = 0; i < offset; i++) celdas.push(null);
  for (let d = 1; d <= total; d++) celdas.push(isoDate(new Date(year, month, d)));
  while (celdas.length % 7) celdas.push(null);
  return celdas;
};

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 12.5 -> "12,5"; 12 -> "12" */
export const num = (n, dec = 1) => {
  if (n == null || Number.isNaN(n)) return '–';
  const r = Math.round(n * 10 ** dec) / 10 ** dec;
  return String(r).replace('.', ',');
};

/** Segundos -> "1:05" si >= 60, si no "45 s" */
export const fmtSeg = (s) => {
  if (s == null) return '–';
  s = Math.round(s);
  return s >= 60 ? `${Math.floor(s / 60)}:${pad(s % 60)}` : `${s} s`;
};

export const fmtValor = (v, tipo) => (v == null ? '–' : tipo === 'tiempo' ? fmtSeg(v) : `${num(v, 0)}`);
export const unidad = (tipo) => (tipo === 'tiempo' ? 's' : 'reps');

export const debounce = (fn, ms = 300) => {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
  return wrapped;
};

export const parseNum = (v) => {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

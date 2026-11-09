// Capa de persistencia sobre IndexedDB.
//
// Modelo relacional (4 tablas + meta):
//   objetivos       { id, nombre }
//   ejercicios      { id, nombre, tipo: 'reps' | 'tiempo' | 'complejo', objetivo_id | null, zona?, factor?, asistido?, clave? }   (zona: zonas.js · factor/asistido: stats.js cargaDe)
//   entrenamientos  { id, fecha: 'YYYY-MM-DD', notas }
//   series          { id, entrenamiento_id, ejercicio_id, set_numero, valor, peso_extra, segundos? }   (segundos: solo 'complejo')
//   meta            { key, value }   (última copia de seguridad, etc.)

const DB_NAME = 'calistenia-tracker';
const DB_VERSION = 1;

export const STORES = ['objetivos', 'ejercicios', 'entrenamientos', 'series'];

let dbPromise;
let nEscrituras = 0;
/** Nº de escrituras hechas en esta sesión: sirve para saber si un "Deshacer" sigue siendo seguro. */
export const escrituras = () => nEscrituras;

// Aviso de cambios (lo usa la sincronización en la nube). Se silencia mientras se aplican datos bajados de la nube.
let alCambiar = null, silencio = false;
export const onCambio = (cb) => { alCambiar = cb; };
export const silenciar = (v) => { silencio = v; };
function cambio(store) {
  nEscrituras++;
  if (!silencio && store !== 'meta' && alCambiar) alCambiar();
}

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Aquí irán las migraciones futuras: if (e.oldVersion < 2) {...}
      if (!db.objectStoreNames.contains('objetivos')) db.createObjectStore('objetivos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('ejercicios')) {
        db.createObjectStore('ejercicios', { keyPath: 'id' }).createIndex('objetivo_id', 'objetivo_id');
      }
      if (!db.objectStoreNames.contains('entrenamientos')) {
        db.createObjectStore('entrenamientos', { keyPath: 'id' }).createIndex('fecha', 'fecha');
      }
      if (!db.objectStoreNames.contains('series')) {
        const s = db.createObjectStore('series', { keyPath: 'id' });
        s.createIndex('entrenamiento_id', 'entrenamiento_id');
        s.createIndex('ejercicio_id', 'ejercicio_id');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Si otra pestaña pide actualizar el esquema, cerramos para no bloquearla.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB bloqueada por otra pestaña'));
  });
  return dbPromise;
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

export async function getAll(store) {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

export async function put(store, value) {
  cambio(store);
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function putMany(store, values) {
  cambio(store);
  if (!values.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  values.forEach((v) => tx.objectStore(store).put(v));
  return done(tx);
}

export async function del(store, id) {
  cambio(store);
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  return done(tx);
}

export async function delMany(store, ids) {
  cambio(store);
  if (!ids.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  ids.forEach((id) => tx.objectStore(store).delete(id));
  return done(tx);
}

export async function getMeta(key) {
  const db = await open();
  const r = await wrap(db.transaction('meta').objectStore('meta').get(key));
  return r ? r.value : null;
}

export async function setMeta(key, value) {
  return put('meta', { key, value });
}

/** Carga todo el dataset en memoria (es pequeño: miles de series caben de sobra). */
export async function loadAll() {
  const [objetivos, ejercicios, entrenamientos, series] = await Promise.all(STORES.map(getAll));
  return { objetivos, ejercicios, entrenamientos, series };
}

/** Sustituye TODO el contenido por `data` en una única transacción atómica. */
export async function replaceAll(data) {
  cambio('*');
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) {
    const os = tx.objectStore(s);
    os.clear();
    (data[s] || []).forEach((v) => os.put(v));
  }
  return done(tx);
}

/** Borra series (y entrenamientos) dentro de una sola transacción. */
export async function deleteWhere({ series = [], entrenamientos = [], ejercicios = [], objetivos = [] }) {
  cambio('*');
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  series.forEach((id) => tx.objectStore('series').delete(id));
  entrenamientos.forEach((id) => tx.objectStore('entrenamientos').delete(id));
  ejercicios.forEach((id) => tx.objectStore('ejercicios').delete(id));
  objetivos.forEach((id) => tx.objectStore('objetivos').delete(id));
  return done(tx);
}

/**
 * Pide al navegador que NO desaloje nuestros datos bajo presión de almacenamiento.
 * En iOS funciona de forma fiable cuando la app está instalada en la pantalla de inicio.
 */
export async function pedirPersistencia() {
  try {
    if (!navigator.storage) return { soportado: false, persistente: false };
    let persistente = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    if (!persistente && navigator.storage.persist) persistente = await navigator.storage.persist();
    return { soportado: true, persistente };
  } catch {
    return { soportado: false, persistente: false };
  }
}

// ---------- Copias de seguridad ----------

export function exportarJSON(state) {
  return JSON.stringify({
    app: 'calisthenics-tracker',
    version: 1,
    exportado: new Date().toISOString(),
    objetivos: state.objetivos,
    ejercicios: state.ejercicios,
    entrenamientos: state.entrenamientos,
    series: state.series,
  }, null, 2);
}

/** Valida y normaliza un JSON importado. Lanza Error con mensaje legible si no es válido. */
export function validarImport(texto) {
  let d;
  try { d = JSON.parse(texto); } catch { throw new Error('El archivo no es un JSON válido.'); }
  if (!d || d.app !== 'calisthenics-tracker') throw new Error('Este archivo no es una copia de Calisthenics Tracker.');
  for (const s of STORES) if (!Array.isArray(d[s])) throw new Error(`Falta la tabla "${s}" en la copia.`);

  const ids = (arr) => new Set(arr.map((x) => x && x.id));
  const objIds = ids(d.objetivos), ejIds = ids(d.ejercicios), enIds = ids(d.entrenamientos);

  const ok =
    d.objetivos.every((o) => o && o.id && typeof o.nombre === 'string') &&
    d.ejercicios.every((e) => e && e.id && typeof e.nombre === 'string' && (e.tipo === 'reps' || e.tipo === 'tiempo' || e.tipo === 'complejo') && (e.objetivo_id == null || objIds.has(e.objetivo_id))) &&
    d.entrenamientos.every((t) => t && t.id && /^\d{4}-\d{2}-\d{2}$/.test(t.fecha)) &&
    d.series.every((s) => s && s.id && enIds.has(s.entrenamiento_id) && ejIds.has(s.ejercicio_id));
  if (!ok) throw new Error('La copia tiene datos inconsistentes (referencias rotas o campos inválidos).');

  return {
    objetivos: d.objetivos, ejercicios: d.ejercicios,
    entrenamientos: d.entrenamientos, series: d.series,
  };
}

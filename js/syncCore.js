// Motor de sincronización — lógica pura (sin Firebase ni IndexedDB), por eso se puede probar en Node.
//
// Modelo en la nube (Firestore, bajo users/{uid}/data/...):
//   catalogo        → { objetivos: [...], ejercicios: [...] }
//   mes-YYYY-MM     → { entrenamientos: [...], series: [...] }   (todo un mes en un documento)
//
// Cada documento se compara por "firma" (hash del contenido canónico) contra la `base`: la firma que tenía
// la última vez que se sincronizó. Así sabemos quién cambió desde entonces:
//   solo local cambió  → subir      solo la nube cambió → bajar      ambos → fusionar por id (gana lo local)
// Los borrados se propagan con una "lápida" ({_borrado:true}). En cambio, que un documento FALTE en la nube
// (p. ej. borrado a mano desde la consola) NUNCA borra datos locales: se vuelve a subir.

const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** JSON canónico: claves ordenadas, sin undefined (para que la misma información dé siempre la misma firma). */
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** Hash de 53 bits (cyrb53) en base 36. No es criptográfico: solo detecta cambios. */
export function firma(obj) {
  const s = canon(obj);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + '.' + s.length.toString(36);
}

const limpiar = (o) => JSON.parse(JSON.stringify(o));

/** Estado local → documentos de la nube. */
export function construirDocs(estado) {
  const docs = {};
  if (estado.objetivos.length || estado.ejercicios.length) {
    docs.catalogo = { objetivos: [...estado.objetivos].sort(porId), ejercicios: [...estado.ejercicios].sort(porId) };
  }
  const mesDeEnt = new Map();
  for (const e of estado.entrenamientos) {
    const k = 'mes-' + e.fecha.slice(0, 7);
    mesDeEnt.set(e.id, k);
    (docs[k] ||= { entrenamientos: [], series: [] }).entrenamientos.push(e);
  }
  for (const s of estado.series) {
    const k = mesDeEnt.get(s.entrenamiento_id);
    if (k) docs[k].series.push(s);
  }
  for (const d of Object.values(docs)) for (const campo of Object.keys(d)) d[campo].sort(porId);
  return limpiar(docs);
}

/** Documentos → estado local completo. */
export function docsAEstado(docs) {
  const est = { objetivos: [], ejercicios: [], entrenamientos: [], series: [] };
  for (const [k, d] of Object.entries(docs)) {
    if (k === 'catalogo') { est.objetivos.push(...(d.objetivos || [])); est.ejercicios.push(...(d.ejercicios || [])); }
    else if (k.startsWith('mes-')) { est.entrenamientos.push(...(d.entrenamientos || [])); est.series.push(...(d.series || [])); }
  }
  return est;
}

/** Une dos versiones de un documento por id de registro; ante el mismo id gana `a` (lo local). */
export function fusionar(a, b) {
  const out = {};
  for (const campo of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const mapa = new Map();
    for (const r of b[campo] || []) mapa.set(r.id, r);
    for (const r of a[campo] || []) mapa.set(r.id, r);
    out[campo] = [...mapa.values()].sort(porId);
  }
  return out;
}

/**
 * @param locales  { clave: contenido }
 * @param remotos  { clave: contenido }
 * @param base     { clave: firma }   (última sincronización)
 */
export function planificar(locales, remotos, base) {
  const plan = { subir: {}, borrarRemoto: [], finales: {}, base: {}, cambiaLocal: false, conflictos: [], bajados: [] };
  const claves = new Set([...Object.keys(locales), ...Object.keys(remotos), ...Object.keys(base)]);
  for (const k of claves) {
    const L = locales[k];
    const lapida = !!(remotos[k] && remotos[k]._borrado);
    const R = lapida ? undefined : remotos[k];
    const sL = L ? firma(L) : null, sR = R ? firma(R) : null, sB = base[k] ?? null;
    const lc = sL !== sB, rc = sR !== sB;

    if (!lc && !rc) { if (L) { plan.finales[k] = L; plan.base[k] = sL; } continue; }

    if (lc && !rc) {                                  // solo cambió lo local
      if (L) { plan.subir[k] = L; plan.finales[k] = L; plan.base[k] = sL; }
      else plan.borrarRemoto.push(k);                 // borrado deliberado en local
      continue;
    }
    if (!lc && rc) {                                  // solo cambió la nube
      if (R) { plan.finales[k] = R; plan.base[k] = sR; plan.cambiaLocal = true; plan.bajados.push(k); }
      else if (lapida) { plan.cambiaLocal = true; plan.bajados.push(k); }           // otro dispositivo lo borró: se borra aquí también
      else if (L) { plan.subir[k] = L; plan.finales[k] = L; plan.base[k] = sL; }   // faltaba en la nube: se restaura, no se borra lo local
      continue;
    }
    // Cambiaron los dos lados
    if (sL === sR) { if (L) { plan.finales[k] = L; plan.base[k] = sL; } continue; }   // convergieron (o ambos borrados)
    const M = L && R ? fusionar(L, R) : (L || R);
    const sM = firma(M);
    plan.finales[k] = M; plan.base[k] = sM; plan.subir[k] = M; plan.conflictos.push(k);
    if (sM !== sL) plan.cambiaLocal = true;
  }
  return plan;
}

/**
 * Ejecuta una sincronización completa con dependencias inyectadas.
 *  leerLocal()          → estado en memoria (copia o referencia; no se modifica aquí)
 *  remoto.listar()      → { clave: contenido }
 *  remoto.escribir({subir, borrar, ahora})
 *  leerBase()/guardarBase(base)
 *  aplicarLocal(estado) → reemplaza los datos locales
 *  escrituras()         → contador de escrituras locales (detecta cambios del usuario durante la espera)
 */
export async function ejecutarSync({ leerLocal, remoto, leerBase, guardarBase, aplicarLocal, escrituras, ahora = Date.now }) {
  for (let intento = 0; intento < 3; intento++) {
    const n0 = escrituras();
    const locales = construirDocs(leerLocal());
    const remotos = await remoto.listar();
    const base = (await leerBase()) || {};
    const plan = planificar(locales, remotos, base);

    if (plan.cambiaLocal) {
      if (escrituras() !== n0) continue;              // el usuario cambió algo mientras esperábamos: reintentar
      await aplicarLocal(docsAEstado(plan.finales));
    }
    const nSubir = Object.keys(plan.subir).length;
    if (nSubir || plan.borrarRemoto.length) await remoto.escribir({ subir: plan.subir, borrar: plan.borrarRemoto, ahora: ahora() });
    await guardarBase(plan.base);
    return { subidos: nSubir, borrados: plan.borrarRemoto.length, bajados: plan.bajados.length, conflictos: plan.conflictos.length };
  }
  throw new Error('Hay cambios locales continuos; se reintentará en unos segundos.');
}

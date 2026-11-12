// Sincronización con Firebase (Auth email/contraseña + Firestore).
// IndexedDB sigue siendo la fuente de verdad en el iPhone; la nube es copia y sincronización.
// El SDK de Firebase solo se carga si hay configuración (js/firebase-config.js).

import * as DB from './db.js';
import { ejecutarSync, COMUN } from './syncCore.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

export const configurado = !!FIREBASE_CONFIG;

const est = {
  fase: configurado ? 'sinsesion' : 'noconfig',   // noconfig | sinsesion | listo | sincronizando | ok | offline | error
  usuario: null,                                  // { uid, email }
  ultima: null,                                   // timestamp de la última sync correcta
  error: null,
  comunOk: true,                                  // false si las reglas de Firestore no dejan usar el catálogo común
};

let fb = null, auth = null, fs = null, ctx = null;
let enCurso = null, pendiente = false, timer = null;
const notificar = () => ctx && ctx.onEstado && ctx.onEstado(est);

export function mensajeError(e) {
  const c = (e && (e.code || '')) + '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|missing-password/.test(c)) return 'Email o contraseña incorrectos.';
  if (/too-many-requests/.test(c)) return 'Demasiados intentos. Espera unos minutos.';
  if (/network-request-failed|unavailable/.test(c)) return 'Sin conexión con Firebase.';
  if (/permission-denied/.test(c)) return 'Firestore no permite el acceso: revisa las reglas de seguridad.';
  if (/operation-not-allowed/.test(c)) return 'Activa el acceso con email/contraseña en Firebase Authentication.';
  if (/api-key|invalid-api-key/.test(c)) return 'La apiKey de la configuración no es válida.';
  return (e && e.message) || 'Error desconocido.';
}

async function cargarSDK() {
  if (fb) return fb;
  fb = await import('../vendor/firebase.js');
  const app = fb.initializeApp(FIREBASE_CONFIG);
  auth = fb.initializeAuth(app, { persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence] });
  // Detecta automáticamente si WebSocket falla (algunas redes/Safari) y cae a long-polling
  fs = fb.initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  return fb;
}

const quitarMeta = (v) => { const { v: _v, updatedAt: _u, ...resto } = v; return resto; };
const limpiar = (o) => JSON.parse(JSON.stringify(o));

/** Ejecuta el motor con el almacenamiento real de la app. (Se exporta también para poder probarlo con una nube simulada.) */
function correr(remoto, uid) {
  // Si mientras tanto se cambió de cuenta, se aborta: nunca se mezclan los datos de dos cuentas.
  const vigente = () => { if (ctx.cuenta && ctx.cuenta() !== uid) throw Object.assign(new Error('Cambio de cuenta'), { code: 'cuenta-cambiada' }); };
  return ejecutarSync({
    leerLocal: () => { vigente(); return ctx.getState(); },
    remoto: { ...remoto, escribir: async (x) => { vigente(); return remoto.escribir(x); } },
    leerBase: async () => { const m = await DB.getMeta('syncBase'); return m && m.uid === uid ? m.firmas : {}; },
    guardarBase: (firmas) => { vigente(); return DB.setMeta('syncBase', { uid, firmas }); },
    aplicarLocal: (estado) => { vigente(); return ctx.setState(estado); },
    escrituras: DB.escrituras,
  });
}

async function sincronizar() {
  if (!est.usuario) return;
  if (enCurso) { pendiente = true; return enCurso; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { est.fase = 'offline'; notificar(); return; }

  est.fase = 'sincronizando'; est.error = null; notificar();
  enCurso = (async () => {
    try {
      ctx.flush();
      const uid = est.usuario.uid;
      const col = fb.collection(fs, 'users', uid, 'data');       // lo de cada usuario
      const docComun = fb.doc(fs, 'comun', 'catalogo');           // los ejercicios, comunes a todos
      const ref = (k) => (k === COMUN ? docComun : fb.doc(col, k));
      let conComun = true;
      const remoto = {
        conComun: () => conComun,
        async listar() {
          const snap = await fb.getDocs(col);
          const out = {};
          snap.forEach((d) => { const v = d.data(); out[d.id] = v._borrado ? { _borrado: true } : quitarMeta(v); });
          try {
            const c = await fb.getDoc(docComun);
            if (c.exists()) out[COMUN] = quitarMeta(c.data());
            conComun = true;
          } catch (e) {
            // Reglas de Firestore sin el catálogo común: se sigue sincronizando lo tuyo y se avisa en Ajustes.
            if (!/permission-denied/.test((e && e.code) || '')) throw e;
            conComun = false;
          }
          est.comunOk = conComun;
          return out;
        },
        async escribir({ subir, borrar, ahora }) {
          const b = fb.writeBatch(fs);               // atómico: catálogo y meses cambian juntos o no cambian
          for (const [k, d] of Object.entries(subir)) b.set(ref(k), { ...limpiar(d), v: 1, updatedAt: ahora });
          for (const k of borrar) b.set(ref(k), { _borrado: true, v: 1, updatedAt: ahora });
          await b.commit();
        },
      };
      const r = await correr(remoto, uid);
      est.fase = 'ok'; est.ultima = Date.now(); est.resumen = r;
    } catch (e) {
      if (e && e.code === 'cuenta-cambiada') return;   // se cambió de cuenta a mitad: no es un error
      console.warn('Sync', e);
      est.fase = (e && /unavailable|network/.test(e.code || '')) ? 'offline' : 'error';
      est.error = mensajeError(e);
    } finally {
      enCurso = null; notificar();
      if (pendiente) { pendiente = false; solicitar(1500); }
    }
  })();
  return enCurso;
}

/** Pide una sincronización dentro de `ms` milisegundos (agrupa varias peticiones seguidas). */
function solicitar(ms = 4000) {
  if (!est.usuario) return;
  clearTimeout(timer);
  timer = setTimeout(sincronizar, ms);
}

async function iniciar(contexto) {
  ctx = contexto;
  if (!configurado) return;
  try {
    await cargarSDK();
  } catch (e) {
    est.fase = 'error'; est.error = 'No se pudo cargar el SDK de Firebase.'; notificar(); return;
  }
  // Cada cambio de sesión se procesa en orden: se deja terminar la sync en curso, la app cambia a la base de esa
  // cuenta (o a la de «sin sesión») y solo entonces se sincroniza. Así nunca se suben datos de una cuenta a otra.
  let cola = Promise.resolve();
  fb.onAuthStateChanged(auth, (u) => {
    cola = cola.then(async () => {
      clearTimeout(timer);
      est.usuario = null;                      // mientras cambia, no arranca ninguna sync nueva
      if (enCurso) { try { await enCurso; } catch { /* da igual */ } }
      try {
        if (ctx.cambiarCuenta) await ctx.cambiarCuenta(u ? u.uid : null);
      } catch (e) {
        console.warn('Cambio de cuenta', e);
        est.fase = 'error'; est.error = 'No se pudieron abrir los datos de esta cuenta en el dispositivo.'; notificar();
        return;
      }
      est.usuario = u ? { uid: u.uid, email: u.email } : null;
      est.fase = u ? 'listo' : 'sinsesion';
      est.error = null; est.ultima = null; est.comunOk = true;
      notificar();
      if (u) solicitar(300);
    });
  });
  DB.onCambio(() => solicitar(5000));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') solicitar(600); });
  window.addEventListener('online', () => solicitar(800));
}

async function login(email, password) {
  await cargarSDK();
  await fb.signInWithEmailAndPassword(auth, email, password);
  est.error = null;
}

async function logout() {
  if (fb && auth) await fb.signOut(auth);
}

export const Sync = { estado: est, iniciar, login, logout, ahora: sincronizar, mensajeError, _correr: correr };

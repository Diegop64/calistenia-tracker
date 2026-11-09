// Biblioteca de ejercicios base de calistenia.
// Cada ejercicio: [clave estable, nombre, tipo, opciones?]. La `clave` permite detectar qué ejercicios
// de la biblioteca ya tienes (aunque renombres otros) y añadir/quitar sin duplicar.
// Dentro de cada grupo van ordenados de más fácil a más difícil (los accesorios, al final).
//
// Back lever y Bandera humana se retiraron de la biblioteca a petición del usuario (sus claves siguen en zonas.js
// por si alguien conserva esos ejercicios).
//
// Dos clases de grupo:
//   habilidad: true  → es un OBJETIVO (Press a pino, Front lever…): sus ejercicios se agrupan y se mide el progreso conjunto.
//   habilidad: false → solo ordena la biblioteca (Espalda, Pierna…): NO crea objetivo; esos ejercicios se ven por zona (zonas.js).
//
// opciones: { f } = parte del peso corporal que mueves (1 = todo, 0.65 = flexiones, 0 = solo los kg: press, curl…)
//           { asist: true } = ejercicio con banda: los kg son asistencia y RESTAN carga (menos banda = progreso).
// Sin `f`, un ejercicio de reps mueve todo tu peso (1).

export const BIBLIOTECA = [
  { clave: 'pino', nombre: 'Press a pino', habilidad: true, ejercicios: [
    ['pino-pike', 'Pike push-ups', 'reps', { f: 0.7 }],
    ['pino-pike-elev', 'Pike push-ups con pies en cajón (elevados)', 'reps', { f: 0.75 }],
    ['pino-pelota', 'Pike push-ups sobre pelota de yoga (con aguante)', 'complejo', { f: 0.75 }],
    ['pino-hold', 'Aguante en pino de cara a la pared (handstand hold)', 'tiempo'],
    ['pino-hold-libre', 'Pino libre (freestanding handstand)', 'tiempo'],
    ['pino-neg', 'Press a pino negativo en pared (reps × segundos de bajada)', 'complejo'],
    ['pino-pared', 'Press a pino en pared (wall HSPU)', 'reps'],
    ['pino-libre', 'Press a pino libre (freestanding HSPU)', 'reps'],
    ['pino-militar', 'Press militar (con kg)', 'reps', { f: 0 }],
  ] },
  { clave: 'fl', nombre: 'Front Lever', habilidad: true, ejercicios: [
    ['fl-remo', 'Remo invertido (inverted row)', 'reps', { f: 0.6 }],
    ['fl-tuck', 'Tuck front lever', 'tiempo'],
    ['fl-tuck-raise', 'Tuck front lever raises', 'reps'],
    ['fl-tuck-pullup', 'Tuck front lever pull-ups', 'reps'],
    ['fl-adv', 'Advanced tuck front lever', 'tiempo'],
    ['fl-one-leg', 'Front lever a una pierna (one-leg)', 'tiempo'],
    ['fl-straddle', 'Straddle front lever', 'tiempo'],
    ['fl-full', 'Front lever completo', 'tiempo'],
    ['fl-piernas', 'Elevación de piernas colgado (hanging leg raise)', 'reps'],
  ] },
  { clave: 'planche', nombre: 'Planche', habilidad: true, ejercicios: [
    ['pl-plancha', 'Plancha frontal (front plank)', 'tiempo'],
    ['pl-lean', 'Planche lean', 'tiempo'],
    ['pl-lean-pu', 'Lean planche push-ups', 'reps', { f: 0.75 }],
    ['pl-tuck', 'Tuck planche', 'tiempo'],
    ['pl-tuck-pu', 'Tuck planche push-ups', 'reps', { f: 0.9 }],
    ['pl-adv', 'Advanced tuck planche', 'tiempo'],
    ['pl-straddle', 'Straddle planche', 'tiempo'],
    ['pl-full', 'Full planche', 'tiempo'],
  ] },
  { clave: 'muscleup', nombre: 'Muscle-up', habilidad: true, ejercicios: [
    ['mu-banda', 'Dominadas explosivas con banda', 'reps', { asist: true }],
    ['mu-pecho', 'Dominada pecho a barra (chest-to-bar)', 'reps'],
    ['mu-explosiva', 'Dominada explosiva (explosive pull-up)', 'reps'],
    ['mu-fondos', 'Fondos en barra recta (straight bar dips)', 'reps'],
    ['mu-neg', 'Muscle-up negativo (reps × segundos de bajada)', 'complejo'],
    ['mu-barra', 'Muscle-up en barra', 'reps'],
  ] },
  // ---- Grupos de ejercicios (no son objetivos: se ven por zona) ----
  { clave: 'traccion', nombre: 'Espalda (tracción)', habilidad: false, ejercicios: [
    ['tr-hang', 'Aguante en barra (dead hang)', 'tiempo'],
    ['tr-escapulares', 'Dominadas escapulares (scapular pull-ups)', 'reps'],
    ['tr-asistidas', 'Dominadas asistidas con banda', 'reps', { asist: true }],
    ['tr-negativas', 'Dominadas negativas (reps × segundos de bajada)', 'complejo'],
    ['tr-supinas', 'Dominadas supinas (chin-ups)', 'reps'],
    ['tr-pronas', 'Dominadas pronas (pull-ups)', 'reps'],
    ['tr-arquero', 'Dominadas arquero (archer pull-ups)', 'reps'],
    ['tr-curl', 'Curl de bíceps (con kg)', 'reps', { f: 0 }],
  ] },
  { clave: 'empuje', nombre: 'Pecho y empuje', habilidad: false, ejercicios: [
    ['em-flexiones', 'Flexiones (push-ups)', 'reps', { f: 0.65 }],
    ['em-declinadas', 'Flexiones declinadas (pies elevados)', 'reps', { f: 0.75 }],
    ['em-diamante', 'Flexiones diamante', 'reps', { f: 0.65 }],
    ['em-fondos', 'Fondos en paralelas (dips)', 'reps'],
    ['em-arquero', 'Flexiones arquero (archer push-ups)', 'reps', { f: 0.7 }],
  ] },
  { clave: 'core', nombre: 'Core', habilidad: false, ejercicios: [
    ['co-hollow', 'Hollow body', 'tiempo'],
    ['co-tuck-lsit', 'Tuck L-sit', 'tiempo'],
    ['co-lsit', 'L-sit', 'tiempo'],
    ['co-dragon', 'Dragon flag', 'reps'],
    ['co-vsit', 'V-sit', 'tiempo'],
  ] },
  { clave: 'pierna', nombre: 'Pierna', habilidad: false, ejercicios: [
    ['pi-sentadilla', 'Sentadilla (con kg)', 'reps', { f: 0 }],
    ['pi-hip', 'Puente de glúteo / hip thrust', 'reps', { f: 0 }],
    ['pi-gemelos', 'Elevación de gemelos', 'reps'],
    ['pi-bulgara', 'Sentadilla búlgara', 'reps', { f: 0.8 }],
    ['pi-pistol-asist', 'Pistol asistida (assisted pistol)', 'reps', { f: 0.8 }],
    ['pi-shrimp', 'Sentadilla shrimp', 'reps', { f: 0.9 }],
    ['pi-pistol', 'Pistol squat', 'reps', { f: 0.9 }],
    ['pi-nordic', 'Nordic curl', 'reps', { f: 0.6 }],
  ] },
];

/** Claves de los grupos que NO son objetivos (los objetivos creados con ellos en versiones anteriores se retiran). */
export const GRUPOS_GENERICOS = BIBLIOTECA.filter((g) => !g.habilidad).map((g) => g.clave);

/** Carga por clave de biblioteca, incluidos ejercicios retirados de la biblioteca que alguien puede tener aún. */
export const CARGA_BIB = Object.fromEntries([
  ...BIBLIOTECA.flatMap((g) => g.ejercicios.map(([k, , , o]) => [k, { f: o?.f ?? 1, asist: !!o?.asist }])),
  ['tr-lastre', { f: 1, asist: false }], ['em-fondos-lastre', { f: 1, asist: false }],
]);

/** Tus ejercicios básicos: vienen premarcados la primera vez y el botón «Marcar mis básicos» los selecciona de una vez. */
export const BASICOS = ['em-flexiones', 'pino-pike-elev', 'pino-pelota', 'pl-lean-pu', 'pl-tuck-pu', 'tr-pronas', 'mu-banda', 'mu-barra',
  'fl-piernas', 'fl-tuck-raise', 'tr-supinas', 'pi-sentadilla', 'pino-militar', 'pino-hold', 'tr-curl', 'fl-tuck-pullup'];

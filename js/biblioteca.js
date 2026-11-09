// Biblioteca de ejercicios base de calistenia.
// Cada ejercicio: [clave estable, nombre, tipo]. La `clave` permite detectar qué ejercicios
// de la biblioteca ya tienes (aunque renombres otros) y añadir/quitar sin duplicar.
// Nombres en español con el anglicismo entre paréntesis cuando ayuda a buscar vídeos.

export const BIBLIOTECA = [
  { clave: 'pino', nombre: 'Press a pino', ejercicios: [
    ['pino-pike', 'Pike push-ups', 'reps'],
    ['pino-pike-elev', 'Pike push-ups con pies elevados', 'reps'],
    ['pino-pelota', 'Press a pica sobre pelota de yoga (con aguante)', 'complejo'],
    ['pino-hold', 'Aguante en pino de cara a la pared (handstand hold)', 'tiempo'],
    ['pino-neg', 'Press a pino negativo en pared', 'reps'],
    ['pino-pared', 'Press a pino en pared (wall HSPU)', 'reps'],
    ['pino-libre', 'Press a pino libre (freestanding HSPU)', 'reps'],
  ] },
  { clave: 'fl', nombre: 'Front Lever', ejercicios: [
    ['fl-tuck', 'Tuck front lever', 'tiempo'],
    ['fl-adv', 'Advanced tuck front lever', 'tiempo'],
    ['fl-straddle', 'Straddle front lever', 'tiempo'],
    ['fl-full', 'Front lever completo', 'tiempo'],
    ['fl-remo', 'Remo invertido (inverted row)', 'reps'],
    ['fl-piernas', 'Elevación de piernas colgado (hanging leg raise)', 'reps'],
  ] },
  { clave: 'bl', nombre: 'Back Lever', ejercicios: [
    ['bl-skin', 'Skin the cat', 'reps'],
    ['bl-tuck', 'Tuck back lever', 'tiempo'],
    ['bl-adv', 'Advanced tuck back lever', 'tiempo'],
    ['bl-straddle', 'Straddle back lever', 'tiempo'],
    ['bl-full', 'Back lever completo', 'tiempo'],
  ] },
  { clave: 'planche', nombre: 'Planche', ejercicios: [
    ['pl-plancha', 'Plancha frontal (front plank)', 'tiempo'],
    ['pl-lean', 'Planche lean', 'tiempo'],
    ['pl-tuck', 'Tuck planche', 'tiempo'],
    ['pl-adv', 'Advanced tuck planche', 'tiempo'],
    ['pl-straddle', 'Straddle planche', 'tiempo'],
    ['pl-full', 'Full planche', 'tiempo'],
  ] },
  { clave: 'muscleup', nombre: 'Muscle-up', ejercicios: [
    ['mu-explosiva', 'Dominada explosiva (explosive pull-up)', 'reps'],
    ['mu-pecho', 'Dominada pecho a barra (chest-to-bar)', 'reps'],
    ['mu-fondos', 'Fondos en barra recta (straight bar dips)', 'reps'],
    ['mu-neg', 'Muscle-up negativo', 'reps'],
    ['mu-barra', 'Muscle-up en barra', 'reps'],
  ] },
  { clave: 'traccion', nombre: 'Dominadas y tracción', ejercicios: [
    ['tr-supinas', 'Dominadas supinas (chin-ups)', 'reps'],
    ['tr-pronas', 'Dominadas pronas (pull-ups)', 'reps'],
    ['tr-arquero', 'Dominadas arquero (archer pull-ups)', 'reps'],
    ['tr-lastre', 'Dominadas con lastre (weighted pull-ups)', 'reps'],
    ['tr-hang', 'Aguante en barra (dead hang)', 'tiempo'],
  ] },
  { clave: 'empuje', nombre: 'Fondos y empuje', ejercicios: [
    ['em-flexiones', 'Flexiones (push-ups)', 'reps'],
    ['em-diamante', 'Flexiones diamante', 'reps'],
    ['em-arquero', 'Flexiones arquero (archer push-ups)', 'reps'],
    ['em-fondos', 'Fondos en paralelas (dips)', 'reps'],
    ['em-fondos-lastre', 'Fondos con lastre (weighted dips)', 'reps'],
  ] },
  { clave: 'core', nombre: 'Core y L-sit', ejercicios: [
    ['co-lsit', 'L-sit', 'tiempo'],
    ['co-vsit', 'V-sit', 'tiempo'],
    ['co-hollow', 'Hollow body', 'tiempo'],
    ['co-dragon', 'Dragon flag', 'reps'],
  ] },
  { clave: 'pierna', nombre: 'Pierna', ejercicios: [
    ['pi-bulgara', 'Sentadilla búlgara', 'reps'],
    ['pi-pistol-asist', 'Pistol asistida (assisted pistol)', 'reps'],
    ['pi-pistol', 'Pistol squat', 'reps'],
    ['pi-nordic', 'Nordic curl', 'reps'],
  ] },
  { clave: 'bandera', nombre: 'Bandera humana', ejercicios: [
    ['ba-vertical', 'Bandera vertical (vertical flag)', 'tiempo'],
    ['ba-tuck', 'Tuck human flag', 'tiempo'],
    ['ba-straddle', 'Straddle human flag', 'tiempo'],
    ['ba-full', 'Bandera humana completa (human flag)', 'tiempo'],
  ] },
];

/** Grupos que vienen premarcados la primera vez que abres la biblioteca. */
export const GRUPOS_INICIALES = ['pino', 'muscleup', 'fl', 'bl', 'planche', 'bandera', 'core', 'pierna'];

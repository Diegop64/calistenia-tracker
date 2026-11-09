# Calisthenics Tracker (PWA para iPhone)

App web instalable para registrar entrenos de calistenia y ver si progresas, te estancas o pierdes fuerza.
Sin servidor, sin cuenta, sin App Store: **todo funciona offline** y los datos viven en tu iPhone.

## Qué incluye

| Pestaña | Qué hace |
|---|---|
| **Entrenar** | Registro rápido del día: añade ejercicios, anota reps o segundos + lastre por serie. Muestra la marca de la última vez, copia la serie anterior con un toque y trae **cronómetro** para isométricos. Puedes cambiar de día para registrar entrenos pasados. Cada serie tiene un **check "hecha"**: teclear un valor o parar el cronómetro la marca sola, y un toque en una serie vacía copia la marca de la última vez. Solo cuentan en las estadísticas las series hechas. |
| **Historial** | Calendario mensual + lista. Al abrir un día se compara cada ejercicio con su sesión anterior (mejor serie, volumen, lastre). |
| **Progreso** | **Ejercicios**: gráfico (mejor serie / volumen / lastre máx.), récord, tendencia. **Objetivos**: agrupa ejercicios (p. ej. *Press a pino* = Pike push-ups + aguante en pino) y calcula un índice combinado (100 = punto de partida). Desde aquí también se crean/editan ejercicios y objetivos, y están las **copias de seguridad**. |

**Tendencia**: media de las últimas sesiones frente a las anteriores (hasta 3). Más de +2,5 % = Mejorando, entre ±2,5 % = Estancado, menos de −2,5 % = Bajando.

## Estructura

```
CalisteniaTracker/
├─ index.html          # shell + meta tags iOS
├─ manifest.json       # nombre, iconos, standalone
├─ sw.js               # service worker (offline). ¡Sube VERSION al cambiar archivos!
├─ css/app.css         # Tailwind ya compilado (no hace falta build para desplegar)
├─ src/input.css       # fuente de estilos (Tailwind)
├─ tailwind.config.js
├─ js/
│  ├─ app.js           # vistas y eventos
│  ├─ db.js            # IndexedDB, persistencia, export/import
│  ├─ biblioteca.js    # 50 ejercicios base en 10 grupos (Press a pino, Front Lever, Planche…)
│  ├─ sync.js          # conexión con Firebase (login, Firestore, disparadores)
│  ├─ syncCore.js      # motor de sincronización puro (documentos, firmas, fusión)
│  ├─ firebase-config.js  # ← aquí va tu configuración de Firebase
├─ vendor/firebase.js  # SDK de Firebase empaquetado (auth + firestore), sin CDN
├─ tools/firebase-entry.js  # origen del bundle anterior
│  ├─ stats.js         # tendencias y progreso por objetivo
│  ├─ chart.js         # gráficos SVG propios
│  └─ util.js
└─ icons/              # 192, 512, maskable y apple-touch-icon
```

### Modelo de datos (IndexedDB `calistenia-tracker`)

```
objetivos       { id, nombre }
ejercicios      { id, nombre, tipo: "reps" | "tiempo", objetivo_id | null }
entrenamientos  { id, fecha: "YYYY-MM-DD", notas, ejercicios: [ids en orden] }
series          { id, entrenamiento_id, ejercicio_id, set_numero, valor, peso_extra, hecha }
```
Campos añadidos al esquema pedido (todos opcionales al importar):
- `entrenamientos.ejercicios`: conserva el orden de los ejercicios dentro del día.
- `series.hecha`: serie completada o pendiente (las series antiguas sin este campo cuentan como hechas).
- `ejercicios.clave` / `objetivos.clave`: identifican los de la biblioteca para no duplicarlos.

## Biblioteca de ejercicios

Progreso → Ejercicios → **Biblioteca**. Desplegable por grupo, con checks: marca para añadir, **desmarca para eliminar**. Si algún ejercicio a eliminar tiene registros, aparece un aviso con el número de series y entrenos que se borrarían. También puedes eliminar un ejercicio suelto desde su ficha (lápiz → Eliminar), con el mismo aviso.

## Deshacer

Borrar una serie, quitar un ejercicio del entreno, borrar un entreno, un ejercicio o un objetivo, o aplicar cambios en la biblioteca muestra un aviso con **Deshacer** durante unos segundos. Si haces cualquier cambio después, el deshacer se desactiva para no pisar datos nuevos.

## Probarla en tu PC

```bash
cd F:\CalisteniaTracker
npx serve . -l 8080      # o: python -m http.server 8080
# abre http://localhost:8080
```

## Publicarla gratis en GitHub Pages

1. Crea un repositorio **público** en GitHub (p. ej. `calistenia-tracker`). El código no contiene datos personales; tus entrenos nunca salen del iPhone.
2. Desde la carpeta del proyecto:
   ```bash
   git init
   git add .
   git commit -m "Calisthenics Tracker v1"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/calistenia-tracker.git
   git push -u origin main
   ```
3. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `/ (root)` → Save**.
4. En ~1 minuto estará en `https://TU_USUARIO.github.io/calistenia-tracker/`.

Todas las rutas son relativas, así que funciona en subcarpetas de GitHub Pages sin tocar nada.

## Instalarla en el iPhone

1. Abre la URL **en Safari** (no en el navegador interno de otra app).
2. **Compartir ⎋ → Añadir a pantalla de inicio → Añadir**.
3. Ábrela desde el icono. A partir de aquí registra tus entrenos.

> **Instala primero, registra después.** Safari y la app instalada tienen almacenamiento *separado*. Lo que anotes en una pestaña de Safari no aparece en la app del icono.

## Sincronización con Firebase (Firestore)

IndexedDB sigue siendo la fuente de verdad en el iPhone; Firebase guarda una copia y sincroniza. Si pierdes los datos locales (iOS puede limpiarlos, reinstalas, cambias de móvil), al iniciar sesión se recuperan de la nube.

**Configuración (una sola vez)**
1. Firebase Console → tu proyecto → **Authentication → Método de acceso → Correo electrónico/contraseña → Activar**.
2. **Authentication → Usuarios → Agregar usuario** (tu email y contraseña; usa una contraseña larga y única). Copia el **UID** de ese usuario (columna "UID de usuario"): lo usarás en las reglas.
   - **Desactiva el registro de nuevos usuarios**: Authentication → Configuración → Acciones del usuario → desmarca *Habilitar la creación (registro)*. La app no ofrece registro, pero sin este ajuste cualquiera con la apiKey podría crear cuentas llamando a la API directamente.
3. **Firestore Database → Crear base de datos** (modo producción; elige región europea).
4. **Firestore → Reglas** → pega esto, **sustituye `TU_UID`** por el UID del paso 2 y pulsa *Publicar*. Solo tu usuario puede leer o escribir; cualquier otro, aunque estuviera registrado, recibe "permiso denegado":
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null
                            && request.auth.uid == uid
                            && uid == 'TU_UID';
       }
       match /{document=**} {
         allow read, write: if false;
       }
     }
   }
   ```
5. **Authentication → Configuración → Dominios autorizados** → añade `TU_USUARIO.github.io` (localhost ya viene).
6. **Restringe la apiKey** (opcional, recomendado): Google Cloud Console → APIs y servicios → Credenciales → tu *Browser key* → Restricciones de aplicación: *Sitios web* → añade `https://TU_USUARIO.github.io/*` y `http://localhost:8080/*`. Frena el uso casual desde otros sitios (no es una barrera total: la protección real son el login y las reglas).
7. **Configuración del proyecto → Tus apps → app web → Config** → copia el objeto en `js/firebase-config.js` (sustituye `null`).
8. Sube `js/firebase-config.js` y despliega. En la app: **Progreso → ajustes → Nube → Iniciar sesión**.

**Qué puede hacer alguien que lea el código fuente**
- Ver la configuración (`apiKey`, `projectId`…): es pública por diseño y no da acceso a datos.
- Intentar leer o escribir en Firestore: las reglas lo rechazan sin tu sesión (y solo admiten tu UID).
- Probar contraseñas en tu usuario: Firebase limita los intentos y bloquea temporalmente. Por eso la contraseña debe ser larga.
- Con el plan gratuito (Spark) no hay facturación: si alguien agotara la cuota, el servicio se limitaría, no se cobraría nada. Si algún día pasas a Blaze, activa una alerta de presupuesto.

**Cómo funciona**
- Los datos se guardan en `users/{uid}/data/`: un documento `catalogo` (objetivos y ejercicios) y uno por mes `mes-AAAA-MM` (entrenos y series). Pocos documentos = pocas lecturas, muy por debajo de la cuota gratuita.
- Sincroniza al iniciar sesión, al volver a abrir la app, al recuperar conexión y ~5 s después de cada cambio. Funciona offline: los cambios se suben cuando haya red.
- Cada documento se compara con la última sincronización: si solo cambió un lado, se copia; si cambiaron los dos (p. ej. entrenas en dos dispositivos), se **fusionan por id** sin perder registros.
- Los borrados se propagan. En cambio, si un documento *desaparece* de la nube por accidente (borrado a mano en la consola), **no se borra nada local**: se vuelve a subir.
- Ojo: "Borrar todos los datos" con la sesión iniciada también borra la nube. Exporta una copia antes.

**Regenerar el SDK empaquetado** (solo si quieres actualizar Firebase): `npm i firebase esbuild`, copia `tools/firebase-entry.js` a `src/` y ejecuta `npx esbuild src/firebase-entry.js --bundle --format=esm --minify --platform=browser --target=es2020 --legal-comments=none --outfile=vendor/firebase.js`. Sube `VERSION` en `sw.js`.

## Cómo se protegen tus datos

- Se guardan en **IndexedDB** (no en `localStorage`), con escritura inmediata a cada cambio.
- La app pide **almacenamiento persistente** (`navigator.storage.persist()`).
- Instalada en la pantalla de inicio, iOS **no aplica** el borrado de datos tras 7 días sin uso que sí afecta a las pestañas de Safari.
- Actualizar iOS, Safari o la propia app **no toca** los datos: las actualizaciones solo sustituyen la caché de archivos.
- Los datos **sí se pierden** si borras el icono de la pantalla de inicio, usas “Borrar datos de sitios web” o restauras el iPhone sin copia. Ningún método web puede evitarlo al 100 %, por eso hay copias:

**Copias de seguridad** (Progreso → icono de ajustes): *Exportar copia* abre el menú de compartir de iOS → **Guardar en Archivos → iCloud Drive**. *Importar copia* restaura todo (valida el archivo antes de reemplazar nada). La app te recuerda hacerla si pasan más de 2 semanas.

## Publicar una actualización

1. Cambia lo que quieras.
2. Si tocaste `src/input.css` o añadiste clases Tailwind nuevas: `npm install` y `npm run build:css`.
3. En `sw.js` sube `VERSION` (`v1` → `v2`) y, si añadiste archivos, añádelos a `SHELL`.
4. `git commit` y `git push`.
5. En el iPhone, al abrir la app saldrá “Hay una versión nueva → Actualizar” (nunca se recarga sola en mitad de una serie). Tus datos se conservan.

## Limitaciones conocidas

- La sincronización exige conexión y sesión iniciada; sin ellas la app funciona igual y sincroniza después.
- Sin notificaciones push ni sensores avanzados.
- Una pestaña de Safari y la app instalada no comparten datos (ver arriba).

## Vista de PC y teclado

A partir de 1024 px de ancho (ordenador, iPad horizontal) la app cambia de estructura sin tocar el móvil:

- **Menú lateral** en vez de la barra inferior, con estado de la nube, ajustes y ayuda de atajos.
- **Entrenar**: ejercicios en rejilla (1-2 columnas) y panel lateral con avisos, resumen y notas.
- **Historial** y **Progreso**: lista a la izquierda y detalle a la derecha (la gráfica ocupa todo el ancho).
- **Ventanas** (añadir ejercicio, ajustes…) como diálogo centrado, con el foco en el primer campo.

| Tecla | Acción |
|---|---|
| `1` `2` `3` | Entrenar · Historial · Progreso |
| `N` | Añadir ejercicio al entreno |
| `←` `→` | Día anterior / siguiente (Entrenar) |
| `↑` `↓` | Moverse por la lista (Historial y Progreso) |
| `Enter` | Siguiente campo; tras la última serie crea otra |
| `?` / `Esc` | Ayuda de atajos / cerrar ventana |

Los breakpoints y anchos son variables CSS (`--sidebar-w`, `--shell-max`) en `src/input.css`.
Tras cambiar CSS o JS: `npm run build:css` y subir `VERSION` en `sw.js` (ahora `v8`).

## Tipos de ejercicio

- **Reps**: repeticiones (con lastre opcional).
- **Tiempo**: aguantes isométricos (segundos, con cronómetro).
- **Complejo**: cada serie guarda **reps** y **segundos de aguante por repetición** (p. ej. press a pica sobre pelota de yoga: flexión estando en pica, 10 s). Las gráficas, el récord y la tendencia cuentan las **repeticiones**; hay además una pestaña opcional «Aguante máx.». En los datos, las series de estos ejercicios llevan el campo `segundos`.

## Cómo ha ido y resumen para IA

Cada entreno tiene un bloque **«Cómo ha ido»** (en Entrenar, bajo los ejercicios; en PC, en el panel lateral) con:
energía de 0 a 100, sensación (Fuerte / Bien / Flojo / Cansado), molestias por zona (hombro derecho, codo, muñeca…) y notas libres.
Se guarda en el propio entreno (`energia`, `sensacion`, `molestias`, `notas`), se sincroniza con la nube y se ve en el detalle del Historial.

El botón ✦ de **Historial** (y «Resumen para tu IA» en Datos y copias) genera un texto en Markdown con tus entrenos, series, energía,
molestias, notas, tendencias y objetivos (4 semanas, 12 semanas o todo), con instrucciones opcionales para que la IA analice y proponga ajustes.
Se copia al portapapeles (o se comparte) y se pega en ChatGPT, Claude, etc. Se genera en el dispositivo: nada sale hasta que tú lo pegas.
El código está en `js/resumen.js` (función pura `generarResumen`).

## Zonas, objetivos, carga y fuerza estimada (v12)

- **Zonas** (`js/zonas.js`): cada ejercicio cuenta en una zona principal (Hombro, Pecho y tríceps, Espalda, Bíceps y brazos, Core, Pierna). Progreso → Zonas muestra series, entrenos y comparación con el periodo anterior; la pestaña Ejercicios agrupa el catálogo por zona.
- **Objetivos = solo habilidades** (Press a pino, Front/Back lever, Planche, Muscle-up, Bandera). Los grupos genéricos de la biblioteca (Espalda, Pecho y empuje, Core, Pierna) ya no crean objetivo; los creados por versiones anteriores se retiran solos al abrir la app.
- **Carga por ejercicio** (`cargaDe` en `js/stats.js`): parte del peso corporal que mueves (todo / parte / solo los kg) y si va con banda (los kg restan).
- **Peso corporal**: se anota en «Cómo ha ido» (cada 1-2 semanas basta). Con él, la **fuerza estimada** = carga × (1 + reps/30) mide el progreso cuando hay lastre, banda o kg externos, así que subir lastre y bajar reps no cuenta como bajada.
- **Tendencia**: mejor marca de las últimas 3 sesiones frente a las 3 anteriores; con menos de 4 sesiones no opina. El índice de objetivo usa media geométrica y solo ejercicios entrenados en las últimas 6 semanas.
- **Registro**: al añadir un ejercicio se crean tantas series como la última vez (reps vacías con la marca anterior en gris; ✓ la repite); ★ marca un récord; el crono no sobrescribe series hechas y descarta toques de menos de 3 s; al volver a la app tras unas horas se abre en hoy.

# Guía: publicar Finanzas personales con Firebase y GitHub Pages (gratis)

Esta guía explica, paso a paso, cómo dejar funcionando la app: inicio de sesión con Google, datos privados en Firestore y el código publicado gratis en GitHub Pages. Toma unos 30 minutos la primera vez.

Reemplaza en todo el documento:
- `TU_USUARIO`: tu usuario de GitHub (por ejemplo, `yisuba`).
- `TU_CORREO@gmail.com`: el correo de Google con el que vas a entrar.
- `TU-PROYECTO`: el ID del proyecto de Firebase (aparece en la consola al crearlo).

## Qué es público y qué es privado

- **Público:** el código (`index.html`, `app.js`, `style.css`, etc.) y la configuración de Firebase dentro de `firebase-config.js`. Cualquiera puede verlos.
- **Privado:** tus gastos, ingresos, períodos y categorías, guardados en Firestore. Solo puede leerlos o escribirlos tu cuenta, según las reglas del paso 2.
- La configuración de Firebase no es un secreto. La protección real está en las reglas de Firestore y en las restricciones de la clave (paso 5).
- **Nunca subas tu Excel al repositorio.** El `.gitignore` ya bloquea los archivos `.xlsx` y `.csv`, pero revisa siempre qué archivos vas a subir antes de hacer push.

## Arquitectura

```
Código (index.html, app.js, ...)  → repo público en GitHub → GitHub Pages
Inicio de sesión                  → Firebase Authentication (Google)
Datos (gastos, ingresos, ...)     → Firestore (plan Spark, gratis)
Importar y respaldar Excel        → en tu navegador, con SheetJS (el archivo no sale de tu equipo)
```

## Paso 1: repositorio en GitHub

1. Entra a github.com y haz clic en **New repository**.
2. Nombre: `FinanzasPersonales`. Visibilidad: **Public** (GitHub Pages gratis solo publica repos públicos). Sin README, sin .gitignore y sin licencia: ya vienen en esta carpeta.
3. Haz clic en **Create repository**.
4. Abre GitHub Desktop: **File > Add local repository** y elige esta carpeta (`FinanzasPersonales`, que ya es un repositorio git). Luego **Publish repository** o, si ya creaste el repo vacío, **Repository > Repository settings > Remote** y pega `https://github.com/TU_USUARIO/FinanzasPersonales.git`.

## Paso 2: proyecto en Firebase

Usa un proyecto **nuevo**, separado del de ToDoTasks, para que los datos y las reglas no se mezclen.

1. Entra a [console.firebase.google.com](https://console.firebase.google.com) con tu cuenta de Google y haz clic en **Crear un proyecto** (o **Add project**).
   - Nombre: por ejemplo `finanzas-personales`. Anota el ID que te propone (es `TU-PROYECTO`).
   - Google Analytics: puedes desactivarlo.
2. En el menú izquierdo, **Compilación > Authentication > Comenzar** (Build > Authentication > Get started).
   - Pestaña **Sign-in method** > **Google** > activa el interruptor.
   - Escribe un nombre público (por ejemplo, "Finanzas personales") y elige tu correo como correo de asistencia. **Guardar**.
3. **Compilación > Firestore Database > Crear base de datos**.
   - Elige **modo de producción**.
   - Ubicación: `southamerica-west1` (Santiago). No se puede cambiar después.
4. Firestore > pestaña **Reglas** (Rules): borra lo que haya, pega el contenido de `firestore.rules` de esta carpeta, cambia `TU_CORREO@gmail.com` por tu correo y haz clic en **Publicar**.
5. **Authentication > Settings > Dominios autorizados > Agregar dominio**: escribe `TU_USUARIO.github.io` (sin `https://` ni barra final).
6. Engranaje (arriba a la izquierda) > **Configuración del proyecto** > sección **Tus apps** > ícono **`</>`** (Web).
   - Alias: `finanzas-web`. **No marques Firebase Hosting** (publicamos con GitHub Pages).
   - **Registrar app**. Aparece un bloque `const firebaseConfig = { ... }`. Copia esos seis valores.

## Paso 3: conectar el código con tu proyecto

1. Abre `firebase-config.js` y reemplaza cada valor (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`) por los que copiaste.
2. Guarda. Mientras el archivo tenga `TU_API_KEY`, la app muestra "Falta configurar Firebase".

No necesitas instalar nada: Firebase y SheetJS se cargan desde sus URL oficiales.

## Paso 4: publicar

1. En GitHub Desktop: escribe un mensaje de commit (por ejemplo, "Configuración de Firebase"), **Commit to main** y **Push origin**.
2. En github.com, en el repo `FinanzasPersonales`: **Settings > Pages**. En *Source* elige **Deploy from a branch**, rama **main**, carpeta **/ (root)** y **Save**.
3. Espera uno o dos minutos y abre `https://TU_USUARIO.github.io/FinanzasPersonales`.

## Paso 5: restringir la clave de Google Cloud (recomendado)

GitHub detectará la `apiKey` como "Google API Key" y mostrará una alerta. Es normal: la clave de Firebase es pública por diseño, pero conviene limitar desde dónde se puede usar.

1. Ve a [console.cloud.google.com](https://console.cloud.google.com), elige el proyecto (arriba) y entra a **APIs y servicios > Credenciales**.
2. Abre la clave "Browser key (auto created by Firebase)".
3. **Restricciones de aplicación > Sitios web (referentes HTTP)** y agrega:
   - `https://TU_USUARIO.github.io/*`
   - `https://TU-PROYECTO.firebaseapp.com/*` (obligatorio: el inicio de sesión pasa por esta página)
   - `http://localhost/*` (opcional, para probar en tu computador)
4. **Restricciones de API > Restringir clave**: marca **Identity Toolkit API**, **Token Service API** y **Cloud Firestore API**.
5. Guarda y espera unos minutos.
6. En GitHub, cierra la alerta en **Security > Secret scanning** indicando que es una clave pública de Firebase.

## Paso 6: primer ingreso e importación de tu planilla

1. Abre la app y haz clic en **Entrar con Google** una sola vez.
2. Verás "Aún no hay datos". Haz clic en **Importar desde Excel** y elige `Finanzas_Personales_v1.04.xlsx`.
3. Revisa la vista previa: debería decir **62 gastos ($260.385)** y **2 ingresos ($268.000)**, y crear los períodos Agosto, Septiembre y Octubre.
4. Haz clic en **Importar**. En General, elige Agosto: gastos $126.873, balance $93.127.
5. Abre la misma URL en el celular con la misma cuenta: los datos deben aparecer.
6. Importa solo una vez. Si importas el mismo archivo de nuevo, la app te avisa porque los gastos se duplicarían.

## Uso diario

- **Registrar un gasto:** pestaña Gastos, fila amarilla del final. Enter o **+** para agregar.
- **Editar:** toca la celda, cambia el valor y sal del campo (o Enter). Se guarda solo.
- **Eliminar:** el **✕** de la fila lo manda a la papelera (Configuración > Papelera), desde donde se restaura. No hay borrado definitivo.
- **Terminar un período:** Configuración > Períodos > **Cerrar período**. Sus gastos dejan de verse en Gastos (filtro "Períodos abiertos") pero siguen en General y Resumen. La app ofrece crear el período siguiente.
- **Respaldo:** Configuración > **Descargar respaldo (.xlsx)**. Guárdalo fuera del repositorio.

## Solución de problemas

- **"Falta configurar Firebase"**: `firebase-config.js` todavía tiene los valores de ejemplo (paso 3).
- **`auth/unauthorized-domain` o error al iniciar sesión desde tu sitio**: falta `TU_USUARIO.github.io` en *Dominios autorizados* (paso 2.5).
- **"The requested action is invalid" en `firebaseapp.com/__/auth/handler`**: falta `https://TU-PROYECTO.firebaseapp.com/*` en las restricciones de la clave (paso 5).
- **"Sin permiso para guardar" o "Missing or insufficient permissions"**: las reglas no están publicadas, o el correo de las reglas no es exactamente el de tu cuenta (paso 2.4).
- **"No se pudo leer el archivo"** al importar: revisa tu conexión (SheetJS se descarga la primera vez) y que el archivo tenga una hoja llamada Gastos.
- **La página no se actualiza tras un push**: espera un par de minutos o recarga sin caché (Ctrl+F5).
- **Un navegador o extensión bloquea la ventana de login**: prueba en incógnito con las extensiones desactivadas.

## Probar sin iniciar sesión (opcional)

`tests/` tiene una copia de Firebase en memoria para probar la interfaz:

- `node --test tests/*.test.mjs`: prueba los cálculos (no necesita nada más que Node).
- `EXCEL=/ruta/a/tu.xlsx node tests/prueba-ui.mjs`: abre la app en un navegador sin ventana (Playwright), importa el Excel y revisa totales, edición, papelera y cierre de período. Requiere Playwright instalado. El Excel se pasa por ruta: no lo copies dentro del repositorio.

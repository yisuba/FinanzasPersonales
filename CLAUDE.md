# Finanzas personales: contexto para Claude

App web personal para registrar gastos e ingresos por períodos y ver qué porcentaje del gasto va a cada categoría. Reemplaza a la planilla `Finanzas_Personales_v1.04.xlsx` y conserva su estructura (General, Gastos, Ingresos, Resumen, Configuración). Se publica con GitHub Pages y usa Firebase (Authentication con Google y Firestore). Mismo esquema que el repo ToDoTasks.

Este archivo es el contexto de trabajo: mantenerlo al día cuando cambie algo importante. El tutorial para configurar y publicar está en `GUIA-CONFIGURACION.md`.

## Preferencias de trabajo

- Si pido enumerar cambios para evaluar si entendiste, enuméralos y espera mi confirmación antes de tocar archivos.
- Después de cada implementación pedida, responde en este orden:
  1. Lo que entendiste, resumido.
  2. Preguntas o propuestas, solo si hay ambigüedad.
  3. Al final, siempre: **¿QUIERES QUE HAGA COMMIT Y PUSH A MAIN?**
- Hago commit y push a `main` sin preguntar solo si el cambio se puede deshacer con `git revert` y no toca cómo se guardan los datos en Firestore. Si puede afectar esos datos, o si no estoy seguro, pregunto antes con **¿QUIERES QUE HAGA COMMIT Y PUSH A MAIN?** y espero tu "si".
- Los commits no llevan línea de coautoría de Claude ni línea `Claude-Session`.
- Responde siempre en español, incluido el texto visible de la interfaz.
- Antes de hacer push, traigo los cambios remotos con `git fetch`. Si hay commits remotos que no tengo, los integro con un merge normal y lo aviso. Nunca hago force push sin autorización explícita.
- Antes de commitear: `node --check` en cada `.js` y `node --test tests/*.test.mjs`. Si cambia la interfaz, también `tests/prueba-ui.mjs` (ver la guía). Como la app pide login, te digo qué revisar en celular y computador.
- **Los datos no se borran.** Lo que se elimina va a la papelera y se puede restaurar. Ningún cambio debe borrar documentos de gastos, ingresos o listas.
- **El repo es público:** nunca agregar archivos con datos reales (Excel, CSV, capturas con montos reales). Las pruebas usan datos inventados o un Excel pasado por ruta.

## Archivos

- `index.html`: estructura. Cabecera, pestañas tipo hoja de cálculo (`.pestana[data-vista]`), una `section.vista` por pestaña (`#v-general`, `#v-gastos`, `#v-ingresos`, `#v-resumen`, `#v-config`) y los diálogos (`dlg-confirmar`, `dlg-periodo`, `dlg-importar`). Un script en `<head>` aplica el tema guardado antes de pintar.
- `app.js`: interfaz (render de cada pestaña, celdas editables, importación, papelera, tema, sesión). Módulo ES.
- `datos.js`: única capa que habla con Firebase (`crear`, `actualizar`, `borrar`, `escuchar`, `escucharPrefs`, `guardarPrefs`, `idNuevo`, `escribirVarios`, sesión). Firebase se carga desde gstatic.com, versión en la constante `V`.
- `calculos.js`: lógica pura (asignación de períodos, resúmenes, formatos). Sin DOM ni Firebase: se prueba con `node --test`.
- `excel.js`: importar desde la planilla (v1.04 o el boceto original) y exportar el respaldo. SheetJS se carga desde `cdn.sheetjs.com` solo al usarlo.
- `firebase-config.js`: configuración web del proyecto de Firebase (pública).
- `firestore.rules`: copia de referencia de las reglas publicadas en la consola.
- `style.css`: estilos. Colores en variables CSS en `:root` (claro) y `[data-tema="oscuro"]`. Bajo 760 px, KPIs en dos columnas y tablas con desplazamiento horizontal.
- `favicon.svg`: ícono propio.
- `tests/`: `calculos.test.mjs` (node), `datos-simulados.js` (Firebase en memoria) y `prueba-ui.mjs` (Playwright).
- No hay build, ni npm, ni dependencias locales.

## Modelo de datos (Firestore)

Todo vive bajo `usuarios/{uid}`. Las fechas son texto `"AAAA-MM-DD"` (sin hora, así no hay problemas de zona horaria). Los montos son enteros en pesos.

- `gastos/{id}`: `fecha`, `categoriaId` (id en `listas`; vacío = Sin categoría), `descripcion`, `monto`, `pagoId` (id en `listas` o vacío), `comentario`, `eliminado` (bool, papelera), `creado`, `actualizado` (timestamps).
- `ingresos/{id}`: `fecha`, `fuenteId`, `descripcion`, `monto`, `comentario`, `eliminado`, `creado`, `actualizado`.
- `periodos/{id}`: `nombre`, `desde`, `hasta` (inclusive), `cerrado` (bool). El período de un gasto **no se guarda**: se calcula con su fecha (`periodoDe`). Cambiar un intervalo reasigna los gastos solos.
- `listas/{id}`: `tipo` (`"categoria"`, `"fuente"` o `"pago"`), `nombre`, `orden`, `eliminada` (bool, papelera).
- `ajustes/prefs`: `tema` (`"claro"` u `"oscuro"`), `importaciones` (arreglo de `{ fecha, archivo, gastos, ingresos }`, para avisar si se importa dos veces).

Reglas (publicadas en la consola; copia en `firestore.rules`): solo el correo del dueño, y dentro de `usuarios/{uid}` solo el propio `uid`. Si cambias rutas, actualiza las reglas en la consola.

## Decisiones tomadas

- **Aspecto de planilla:** pestañas como hojas, con el color de cada hoja del Excel (General verde, Gastos rojo, Ingresos azul, Resumen morado, Configuración café). Títulos en verde y mayúsculas, subtítulo gris y una fila de separación antes de las tablas (como en la v1.04). Tema claro por defecto; modo oscuro en Configuración (se guarda en `ajustes/prefs` y en `localStorage`).
- **Celdas editables:** cada celda es un `input`/`select` sin borde; se guarda al salir del campo o con Enter; Esc cancela. La última fila (amarilla) agrega; conserva la fecha para registrar varios gastos del mismo día. Al redibujar por cambios de Firestore se conserva el foco y lo escrito (`capturarFoco`/`restaurarFoco`).
- **Montos:** se muestran `2.800` en celdas y `$2.800` en totales; los negativos con signo menos (`-$85.512`), nunca entre paréntesis. Al editar se ve el número sin puntos.
- **Períodos por intervalo** (por ejemplo, 26 mar a 30 abr). Sin año en el nombre salvo que se repita. Se avisa si dos períodos se superponen; el diálogo de nuevo período no deja crear uno superpuesto.
- **Cerrar período:** marca `cerrado: true`. No mueve ni borra nada: el filtro "Períodos abiertos" (por defecto en Gastos e Ingresos) deja de mostrar sus registros, y siguen en General, Resumen y el filtro "Todos". Si no hay un período posterior, ofrece crear el siguiente con fechas sugeridas.
- **General:** selector de período (incluye "Todos los períodos"), KPIs (ingresos, gastos, balance, tasa de ahorro), tabla de categorías con monto y % del gasto, fila "Sin categoría" si hay gastos sin categoría, y tabla de Control a la derecha (sin categoría, total menos tabla, estado).
- **Resumen:** arriba la tabla mensual (una fila por período) y abajo la tabla "Año" (% del gasto por categoría por período, columna Año y fila Gasto total).
- **Papelera sin borrado definitivo** para gastos, ingresos y listas. Enviar a la papelera muestra un aviso con "Deshacer". Una categoría en papelera sigue apareciendo en los resúmenes si tiene gastos (marcada "(en papelera)"), para que el total cuadre.
- **Importar Excel:** se lee en el navegador; vista previa con totales; une listas por nombre sin distinguir mayúsculas ("alcohol" = "Alcohol"); no asigna categoría a gastos sin categoría; si el archivo no trae períodos (boceto original), crea uno por mes.
- **Gasto de $3.000 del 5 de septiembre sin categoría:** se importa así a propósito, para que lo revise el usuario.

## Convenciones

- Textos de interfaz en español. Sin emojis; símbolos de texto simples (✕, +).
- Nunca insertar datos del usuario con `innerHTML`. Usar `el()` de `app.js`, que pone el texto con `textContent`.
- Errores de Firestore con `errorGuardar` (aviso rojo). Avisos con `alertar`.
- Confirmaciones con `confirmar()` (diálogo propio), nunca `confirm()`.
- Todo color que cambie entre claro y oscuro va como token en las dos secciones del inicio de `style.css`.
- La lógica que se pueda probar sin navegador va en `calculos.js` y se agrega una prueba en `tests/calculos.test.mjs`.

## Pendientes e ideas guardadas

- **Comparación entre meses** (pedida para más adelante): monto del período elegido junto al anterior, con variación en pesos y en porcentaje. En la tabla Año: variaciones frente al período anterior.
- **Presupuesto** (quitado de la v1.04, para más adelante): presupuesto por período y categoría, con gastado y diferencia.
- Agrupar períodos (por ejemplo, trimestres) con un campo `grupo` en `periodos`.
- Ordenar categorías arrastrando (el campo `orden` ya existe).
- Instalar como app (PWA) para registrar gastos rápido desde el celular.
- Las fechas usan el selector nativo del dispositivo; su formato lo decide el sistema.
- Si se edita el mismo gasto en dos dispositivos a la vez, gana el último en guardar (cada campo se guarda por separado, así que solo choca si es el mismo campo).

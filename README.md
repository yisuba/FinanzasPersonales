# Finanzas personales

App web para registrar gastos e ingresos por períodos y ver qué porcentaje del gasto va a cada categoría. Funciona como una planilla (pestañas General, Gastos, Ingresos, Resumen y Configuración) y sincroniza entre computador y celular.

- **Código público, datos privados:** el código se publica con GitHub Pages; los datos viven en Firestore y solo los ve la cuenta de Google del dueño.
- **Sin build ni dependencias:** HTML, CSS y JavaScript. Firebase y SheetJS se cargan desde sus CDN.
- **Importa la planilla** `Finanzas_Personales_v1.04.xlsx` y descarga respaldos en `.xlsx`.
- **Nada se borra:** lo eliminado va a una papelera restaurable.

Para configurarla y publicarla, sigue [GUIA-CONFIGURACION.md](GUIA-CONFIGURACION.md). El contexto técnico está en [CLAUDE.md](CLAUDE.md).
